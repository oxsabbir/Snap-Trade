/**
 * Ticker prices per symbol, delivered through the app's ONE public WebSocket
 * (`publicSocket.ts`).
 *
 * The direction of the flow kept from the previous design: the connection lives here as a
 * plain topic subscription, keyed by symbol, and the components subscribe. What changed is
 * that a symbol switch no longer dials — the topic moves on the shared connection — and the
 * 200ms delivery throttle (BTC ticks ~10x a second and re-rendering a chart that often is
 * wasted work) with its volume accumulation moved into this store, because the throttle
 * used to live inside the per-symbol socket class that no longer exists.
 *
 * The initial ticker subscription is delayed half a second so the order book's topic and
 * REST seed claim the link first on trade-screen mounts; recovery paths are never delayed.
 */
import { useCallback, useSyncExternalStore } from 'react';

import {
  subscribeTopic,
  type PublicTopicMessage,
  type SocketStatus,
  type TickerUpdate,
} from '@/lib/kucoin/publicSocket';
import { socketLog } from '@/lib/kucoin/socketLog';

export type { TickerUpdate, SocketStatus };

export type TickerSnapshot = {
  update: TickerUpdate | null;
  direction: 'up' | 'down';
};

const THROTTLE_MS = 200;

/**
 * Delay before the ticker topic subscribes, letting the order book claim the link first on
 * trade-screen mounts. On the shared connection this orders the topics; it never delays a
 * recovery.
 */
const BOOK_FIRST_DELAY_MS = 500;

type Entry = {
  /** Replaced only when a tick arrives, so `useSyncExternalStore` sees a stable identity. */
  snapshot: TickerSnapshot;
  status: SocketStatus;
  listeners: Set<() => void>;
  release: (() => void) | null;
  /** Pending delayed subscribe, cleared if the entry closes before it fires. */
  startTimer: ReturnType<typeof setTimeout> | null;
  /** Throttle state. */
  latest: TickerUpdate | null;
  pendingSize: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  lastEmit: number;
  session: symbol;
  /** Guards the one-time first-tick log per subscription session. */
  deliveredFirstTick: boolean;
};

const entries = new Map<string, Entry>();

/** Shared so an unsubscribed reader gets one stable reference rather than a fresh object. */
const INITIAL: TickerSnapshot = { update: null, direction: 'up' };

function emit(entry: Entry): void {
  for (const listener of entry.listeners) listener();
}

function toTick(symbol: string, message: PublicTopicMessage): TickerUpdate | null {
  if (message.subject !== 'trade.ticker' || !message.data) return null;
  const raw = message.data as Record<string, unknown>;
  const price = Number(raw.price);
  const update: TickerUpdate = {
    symbol,
    price,
    size: Number(raw.size),
    time: Number(raw.time),
    bestAsk: Number(raw.bestAsk),
    bestBid: Number(raw.bestBid),
  };
  return Number.isFinite(update.price) ? update : null;
}

/** Leading-edge throttle: first tick outside the window is delivered, later ones batched. */
function ingest(entry: Entry, update: TickerUpdate): void {
  entry.latest = update;
  if (Number.isFinite(update.size) && update.size > 0) entry.pendingSize += update.size;

  const now = Date.now();
  if (!entry.lastEmit || now - entry.lastEmit >= THROTTLE_MS) {
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = null;
    }
    entry.lastEmit = now;
    const size = entry.pendingSize;
    entry.pendingSize = 0;
    deliver(entry, update, size);
    return;
  }

  if (entry.flushTimer) return;
  const remaining = THROTTLE_MS - (now - entry.lastEmit);
  entry.flushTimer = setTimeout(() => {
    entry.flushTimer = null;
    if (!entry.latest) return;
    entry.lastEmit = Date.now();
    const size = entry.pendingSize;
    entry.pendingSize = 0;
    deliver(entry, entry.latest, size);
  }, Math.max(0, remaining));
}

function deliver(entry: Entry, update: TickerUpdate, size: number): void {
  const delivered = { ...update, size };
  const previous = entry.snapshot.update;
  entry.snapshot = {
    update: delivered,
    direction: previous !== null && previous.price > delivered.price ? 'down' : 'up',
  };
  emit(entry);
}

function open(symbol: string, entry: Entry): void {
  entry.startTimer = setTimeout(() => {
    entry.startTimer = null;
    if (entry.release) return;
    const session = entry.session;
    entry.release = subscribeTopic(`/market/ticker:${symbol}`, {
      onMessage: (message: PublicTopicMessage) => {
        if (!entry.release || entry.session !== session) return;
        const tick = toTick(symbol, message);
        if (!tick) return;
        if (!entry.deliveredFirstTick) {
          entry.deliveredFirstTick = true;
          socketLog('ticker:first-tick', symbol);
        }
        ingest(entry, tick);
      },
      onStatus: (status: SocketStatus) => {
        if (!entry.release || entry.session !== session) return;
        if (entry.status === status) return;
        entry.status = status;
        emit(entry);
      },
    });
  }, BOOK_FIRST_DELAY_MS);
}

function close(entry: Entry): void {
  if (entry.startTimer) {
    clearTimeout(entry.startTimer);
    entry.startTimer = null;
  }
  if (entry.flushTimer) {
    clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
  }
  entry.release?.();
  entry.release = null;
  // Drop anything already parsed but not yet flushed. Without this a tick that arrived just
  // before close() is still delivered by its pending throttle timer, which would land in
  // whatever series the view has moved on to.
  entry.latest = null;
  entry.pendingSize = 0;
  entry.lastEmit = 0;
  entry.deliveredFirstTick = false;
  // Cleared so a later resubscribe never serves this pair's last price to a new view.
  entry.snapshot = INITIAL;
  entry.status = 'connecting';
}

/**
 * Ref-counted per symbol. The topic subscription exists only while something is listening,
 * which is why an imperative read cannot itself keep a price flowing.
 */
export function subscribeTicker(symbol: string, listener: () => void): () => void {
  let entry = entries.get(symbol);
  const created = entry === undefined;
  if (!entry) {
    entry = {
      snapshot: INITIAL,
      status: 'connecting',
      listeners: new Set(),
      release: null,
      startTimer: null,
      latest: null,
      pendingSize: 0,
      flushTimer: null,
      lastEmit: 0,
      session: Symbol('ticker-session'),
      deliveredFirstTick: false,
    };
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
 * Opens a topic subscription for a symbol and drops it again after [holdMs] unless a real
 * subscriber (the trade screen) has taken over the ref count by then.
 *
 * A signal launch lands on the trade screen only after the router has mounted it. Warming
 * the topic here means the first tick is usually already in the snapshot by the time the
 * screen's `useTicker` mounts, so the cold-start price does not have to wait for the dial.
 */
export function prefetchTicker(symbol: string, holdMs = 15_000): void {
  const release = subscribeTicker(symbol, () => {});
  setTimeout(release, holdMs);
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
