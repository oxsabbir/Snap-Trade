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
import { useCallback, useSyncExternalStore } from 'react';
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
 * why an imperative read cannot itself keep a price flowing.
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
