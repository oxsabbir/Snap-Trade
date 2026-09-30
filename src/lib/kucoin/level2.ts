/**
 * Live Level 2 depth for one spot pair over KuCoin's public feed.
 *
 * `/market/level2:{symbol}` only pushes *changes*, so a book built from the socket alone starts
 * empty and fills in one diff at a time. The class therefore reseeds from the REST snapshot on
 * every connect, applies each change to that book at whatever rate it arrives, and only then
 * emits a full snapshot on a timer. Merging is cheap and lossless; the throttled emit is what
 * keeps the UI at a sane frame rate.
 */
import { request } from './client';
import { fetchBullet, invalidateBullet } from './socket';
import { parseLevels, type Level2Snapshot, type PriceLevel } from './orderbook';
import { compareDecimal } from '@/utils/decimal';

export type Level2Status = 'connecting' | 'live' | 'offline';

export type Level2Listener = {
  onSnapshot: (snapshot: Level2Snapshot) => void;
  onStatus: (status: Level2Status) => void;
};

/** How often a merged book is handed to the UI, whatever rate the socket pushes at. */
const EMIT_MS = 150;
const MAX_BACKOFF_MS = 15_000;

function compare(a: string, b: string): number {
  return compareDecimal(a, b) ?? 0;
}

function compareToZero(value: string): number {
  return compareDecimal(value, '0') ?? 1;
}

type RawLevel2 = {
  sequence?: string;
  change?: string;
  changes?: { asks?: unknown; bids?: unknown };
  asks?: unknown;
  bids?: unknown;
  timestamp?: number;
};

/** The REST seed for the incremental feed. Public data, so no signing. */
export async function fetchOrderBookSnapshot(symbol: string): Promise<Level2Snapshot> {
  const data = await request<{ asks?: unknown; bids?: unknown }>(
    '/market/orderbook/level2_100',
    { query: { symbol } }
  );
  return { symbol, asks: parseLevels(data.asks), bids: parseLevels(data.bids) };
}

export class Level2Socket {
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = true;
  private dirty = false;
  private readonly asks = new Map<string, string>();
  private readonly bids = new Map<string, string>();

  constructor(
    private readonly symbol: string,
    private readonly listener: Level2Listener
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.asks.clear();
    this.bids.clear();
    // Drop a book that was merged but not yet emitted, so a stopped socket cannot deliver the
    // previous pair's depth into whatever view has moved on.
    this.dirty = false;
    this.socket?.close();
    this.socket = null;
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.listener.onStatus('connecting');

    // Fetch bullet token and initial order book REST snapshot concurrently
    const [serverResult, snapshotResult] = await Promise.allSettled([
      fetchBullet(),
      fetchOrderBookSnapshot(this.symbol),
    ]);
    if (this.stopped) return;

    if (serverResult.status === 'rejected') {
      this.scheduleReconnect();
      return;
    }
    const server = serverResult.value;

    if (snapshotResult.status === 'fulfilled' && snapshotResult.value) {
      const snapshot = snapshotResult.value;
      if (this.stopped) return;
      this.replace(snapshot.asks, snapshot.bids);
      // Immediately deliver initial snapshot so the UI renders the orderbook with zero delay!
      this.listener.onSnapshot(this.snapshot());
    }

    const url = `${server.endpoint}?token=${encodeURIComponent(server.token)}&pingInterval=${server.pingInterval}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    // Every handler re-checks `stopped`, because close() is asynchronous and a frame already in
    // the event queue can still run after stop() returned.
    socket.onopen = () => {
      if (this.stopped) return;
      this.attempt = 0;
      socket.send(
        JSON.stringify({
          id: Date.now().toString(),
          type: 'subscribe',
          topic: `/market/level2:${this.symbol}`,
          response: true,
        })
      );
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
        }
      }, Math.max(server.pingInterval / 2, 5_000));
      this.listener.onStatus('live');
      if (this.dirty) this.markDirty();
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (this.stopped) return;
      let message: { type?: string; data?: RawLevel2 };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type !== 'message' || !message.data) return;
      if (this.apply(message.data)) this.markDirty();
    };

    socket.onerror = () => {
      if (!this.stopped) this.listener.onStatus('offline');
    };

    socket.onclose = (event: WebSocketCloseEvent) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.socket === socket) this.socket = null;
      if (event?.code === 4001 || event?.code === 4002) {
        invalidateBullet();
      }
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private replace(asks: PriceLevel[], bids: PriceLevel[]): void {
    this.asks.clear();
    this.bids.clear();
    for (const level of asks) this.asks.set(level.price, level.size);
    for (const level of bids) this.bids.set(level.price, level.size);
  }

  private apply(data: RawLevel2): boolean {
    if (data.changes) {
      let changed = this.applySide(data.changes.asks, this.asks);
      if (this.applySide(data.changes.bids, this.bids)) changed = true;
      return changed;
    }

    const snapshotAsks = parseLevels(data.asks);
    const snapshotBids = parseLevels(data.bids);
    if (snapshotAsks.length > 0 || snapshotBids.length > 0) {
      this.replace(snapshotAsks, snapshotBids);
      return true;
    }

    if (typeof data.change === 'string') return this.applyChangeString(data.change);
    return false;
  }

  private applySide(value: unknown, book: Map<string, string>): boolean {
    const levels = parseLevels(value);
    let changed = false;
    for (const level of levels) {
      if (compareToZero(level.size) === 0) {
        if (book.delete(level.price)) changed = true;
      } else {
        book.set(level.price, level.size);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * The v1 `change` string carries no side, so a level already in the book is updated where it
   * lives and a new level is placed by comparing its price with the current best. That matches
   * the book the snapshot established.
   */
  private applyChangeString(change: string): boolean {
    let changed = false;
    for (const entry of change.split(':')) {
      const [price, size] = entry.split(',');
      if (!price || size === undefined) continue;
      if (this.setLevel(price, size)) changed = true;
    }
    return changed;
  }

  private setLevel(price: string, size: string): boolean {
    const remove = compareToZero(size) === 0;
    if (this.asks.has(price)) {
      if (remove) this.asks.delete(price);
      else this.asks.set(price, size);
      return true;
    }
    if (this.bids.has(price)) {
      if (remove) this.bids.delete(price);
      else this.bids.set(price, size);
      return true;
    }
    if (remove) return false;

    const bestAsk = this.best(this.asks, 'min');
    const bestBid = this.best(this.bids, 'max');
    if (bestAsk !== null && compare(price, bestAsk) <= 0) {
      this.asks.set(price, size);
      return true;
    }
    if (bestBid !== null && compare(price, bestBid) >= 0) {
      this.bids.set(price, size);
      return true;
    }
    // No book context yet; the next snapshot will correct the side.
    this.bids.set(price, size);
    return true;
  }

  private best(book: Map<string, string>, direction: 'min' | 'max'): string | null {
    let winner: string | null = null;
    for (const price of book.keys()) {
      if (winner === null) {
        winner = price;
        continue;
      }
      const comparison = compare(price, winner);
      if ((direction === 'min' && comparison < 0) || (direction === 'max' && comparison > 0)) {
        winner = price;
      }
    }
    return winner;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.stopped || !this.dirty) return;
      this.dirty = false;
      this.listener.onSnapshot(this.snapshot());
    }, EMIT_MS);
  }

  private snapshot(): Level2Snapshot {
    return {
      symbol: this.symbol,
      asks: [...this.asks].map(([price, size]) => ({ price, size })),
      bids: [...this.bids].map(([price, size]) => ({ price, size })),
      time: Date.now(),
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    const delay = Math.min(1000 * 2 ** (this.attempt - 1), MAX_BACKOFF_MS);
    this.listener.onStatus('offline');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
