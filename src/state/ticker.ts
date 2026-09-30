/**
 * The live price, held outside the React tree.
 *
 * The price changes several times a second, and everything that used to read it did so from
 * `useState` high in the tree: `useLiveCandles` owned the socket and `CoinDetail` owned the
 * value, so a single tick invalidated the header, the timeframe tabs, the toolbar, the whole
 * order book and the whole order form. Memoisation could not help, because each of those
 * genuinely received a new value.
 *
 * So the direction of the flow is inverted. The socket lives here, keyed by symbol, and the
 * components that display a price subscribe to it as leaves. Everything between them stops
 * re-rendering, and a tick now costs three small components rather than a page.
 *
 * `useSyncExternalStore` rather than a context provider: no provider sits above the consumers,
 * so there is no value identity to memoise on and no re-render to cascade from a provider.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { TickerSocket, type SocketStatus, type TickerUpdate } from '@/lib/kucoin/socket';

/**
 * Tick-to-tick direction, i.e. whether the last trade was up on the previous one. This is
 * deliberately not "change since the candle opened" — that needs the bucket, which only the
 * series knows, and the two mean different things in different places. The header keeps the
 * since-open reading by deriving it itself from the candle; this is the book's mid price,
 * which is conventionally tick-to-tick.
 */
export type TickerDirection = 'up' | 'down';

export type TickerSnapshot = {
  update: TickerUpdate | null;
  direction: TickerDirection;
};

/** Shared so an unsubscribed reader gets one stable reference rather than a fresh object. */
const INITIAL: TickerSnapshot = { update: null, direction: 'up' };

type Entry = {
  /** Replaced only when a tick arrives, so `useSyncExternalStore` sees a stable identity. */
  snapshot: TickerSnapshot;
  status: SocketStatus;
  listeners: Set<() => void>;
  socket: TickerSocket | null;
  appState: { remove: () => void } | null;
};

const entries = new Map<string, Entry>();

function emit(entry: Entry): void {
  for (const listener of entry.listeners) listener();
}

function open(symbol: string, entry: Entry): void {
  const socket = new TickerSocket(symbol, {
    onTick: (update) => {
      // Identity, not the payload, decides whether a tick still belongs to this view.
      // Cleanup and setup run within one commit, so this passes through null and no window
      // exists in which the outgoing socket's tick could reach the incoming pair.
      if (entry.socket !== socket) return;
      const previous = entry.snapshot.update;
      entry.snapshot = {
        update,
        direction: previous !== null && previous.price > update.price ? 'down' : 'up',
      };
      emit(entry);
    },
    onStatus: (status) => {
      if (entry.socket !== socket) return;
      if (entry.status === status) return;
      entry.status = status;
      emit(entry);
    },
  });

  entry.socket = socket;
  socket.start();

  entry.appState = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') socket.start();
    else socket.stop();
  });
}

function close(entry: Entry): void {
  entry.appState?.remove();
  entry.appState = null;
  entry.socket?.stop();
  entry.socket = null;
  // Cleared so a later resubscribe never serves this pair's last price to a new view. The
  // socket's own stop() drops unflushed ticks for the same reason.
  entry.snapshot = INITIAL;
  entry.status = 'connecting';
}

/**
 * Ref-counted per symbol. The connection exists only while something is listening, which is
 * why an imperative read cannot itself keep a price flowing — see `useSeedPrice`.
 */
export function subscribeTicker(symbol: string, listener: () => void): () => void {
  let entry = entries.get(symbol);
  const created = entry === undefined;
  if (!entry) {
    entry = { snapshot: INITIAL, status: 'connecting', listeners: new Set(), socket: null, appState: null };
    entries.set(symbol, entry);
  }
  const target = entry;

  target.listeners.add(listener);
  if (target.listeners.size === 1) open(symbol, target);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    target.listeners.delete(listener);
    if (target.listeners.size > 0) return;
    close(target);
    if (created || entries.get(symbol) === target) entries.delete(symbol);
  };
}

/** Imperative read of the last delivered price. Does not subscribe and keeps no connection. */
export function getTicker(symbol: string): TickerSnapshot {
  return entries.get(symbol)?.snapshot ?? INITIAL;
}

/** Re-renders the caller when this symbol's price moves. For display leaves only. */
export function useTicker(symbol: string): TickerSnapshot {
  const subscribe = useCallback((notify: () => void) => subscribeTicker(symbol, notify), [symbol]);
  return useSyncExternalStore(subscribe, () => entries.get(symbol)?.snapshot ?? INITIAL);
}

/**
 * Re-renders the caller when the connection state changes, and not when the price does.
 * The snapshot is a string, so an unchanged status compares equal and the badge sits still
 * through every tick.
 */
export function useTickerStatus(symbol: string): SocketStatus {
  const subscribe = useCallback((notify: () => void) => subscribeTicker(symbol, notify), [symbol]);
  return useSyncExternalStore(subscribe, () => entries.get(symbol)?.status ?? 'connecting');
}

/**
 * The first price seen for a pair, and then nothing.
 *
 * The order form needs a seed price exactly once per pair, so it must not subscribe: a
 * subscription here would reintroduce the re-render this whole module exists to remove. But a
 * one-shot *read* is not enough either, because the form usually renders before the socket's
 * first tick and would never learn the price without something to wake it. So this
 * subscribes until a price exists, resolves, and unsubscribes — one or two extra renders per
 * pair, and then silence.
 */
export function useSeedPrice(symbol: string): number | null {
  const [seed, setSeed] = useState(() => ({ symbol, price: getTicker(symbol).update?.price ?? null }));

  // A new pair must never be seeded from the outgoing one. Resetting in render keeps that off
  // the critical path and matches the pattern the rest of the app uses.
  if (seed.symbol !== symbol) {
    setSeed({ symbol, price: getTicker(symbol).update?.price ?? null });
  }

  useEffect(() => {
    if (seed.price !== null) return;

    let unsubscribe: (() => void) | null = null;
    let settled = false;

    const resolve = (price: number) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      setSeed((current) => (current.price === null ? { symbol, price } : current));
    };

    unsubscribe = subscribeTicker(symbol, () => {
      const next = getTicker(symbol).update?.price;
      if (next !== undefined && next !== null) resolve(next);
    });

    // A tick can land between this component's render and this effect, which would leave the
    // listener waiting on a price that has already gone by — the form would then sit unpriced
    // for up to a full throttle window. Deferred to a microtask rather than read inline,
    // because writing state in the effect body itself is a cascading render.
    queueMicrotask(() => {
      const missed = getTicker(symbol).update?.price;
      if (missed !== undefined && missed !== null) resolve(missed);
    });

    return () => {
      settled = true;
      unsubscribe?.();
    };
  }, [seed.price, symbol]);

  // A stale `seed.symbol` means this render is still showing the outgoing pair's value,
  // which the setState above has already scheduled a re-render to correct.
  if (seed.symbol !== symbol) return getTicker(symbol).update?.price ?? null;
  return seed.price;
}

/**
 * Side-aware best price seed for the order form.
 *
 * Buy  → best ask (lowest ask = cheapest to lift)
 * Sell → best bid (highest bid = best to hit)
 *
 * Same one-shot semantics as `useSeedPrice`: subscribes until a value exists,
 * resolves, unsubscribes — then silence. Falls back to last-trade price if the
 * bid/ask fields are missing or non-finite.
 */
export function useBestPrice(symbol: string, side: 'buy' | 'sell'): number | null {
  const [seed, setSeed] = useState(() => {
    const snap = getTicker(symbol).update;
    const fb = snap?.price;
    if (!snap) return { symbol, price: fb ?? null };
    const best = side === 'buy' ? snap.bestAsk : snap.bestBid;
    const price = Number.isFinite(best) && best !== null && best !== undefined ? best : fb;
    return { symbol, side, price: price ?? null };
  });

  // Reset on symbol or side change — a flip from buy→sell should reseed to the bid.
  if (seed.symbol !== symbol || seed.side !== side) {
    const snap = getTicker(symbol).update;
    const fb = snap?.price;
    let price: number | null = null;
    if (snap) {
      const best = side === 'buy' ? snap.bestAsk : snap.bestBid;
      price = Number.isFinite(best) && best !== null && best !== undefined ? best : fb ?? null;
    }
    setSeed({ symbol, side, price });
  }

  useEffect(() => {
    if (seed.price !== null) return;

    let unsubscribe: (() => void) | null = null;
    let settled = false;

    const resolve = (price: number) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      setSeed((current) => (current.price === null ? { symbol, side, price } : current));
    };

    unsubscribe = subscribeTicker(symbol, () => {
      const snap = getTicker(symbol).update;
      if (!snap) return;
      const best = side === 'buy' ? snap.bestAsk : snap.bestBid;
      const price = Number.isFinite(best) && best !== null && best !== undefined ? best : snap.price;
      if (price !== undefined && price !== null) resolve(price);
    });

    queueMicrotask(() => {
      const snap = getTicker(symbol).update;
      if (!snap) return;
      const best = side === 'buy' ? snap.bestAsk : snap.bestBid;
      const price = Number.isFinite(best) && best !== null && best !== undefined ? best : snap.price;
      if (price !== undefined && price !== null) resolve(price);
    });

    return () => {
      settled = true;
      unsubscribe?.();
    };
  }, [seed.price, symbol, side]);

  if (seed.symbol !== symbol || seed.side !== side) {
    const snap = getTicker(symbol).update;
    const fb = snap?.price;
    let price: number | null = null;
    if (snap) {
      const best = side === 'buy' ? snap.bestAsk : snap.bestBid;
      price = Number.isFinite(best) && best !== null && best !== undefined ? best : fb ?? null;
    }
    return price;
  }
  return seed.price;
}
