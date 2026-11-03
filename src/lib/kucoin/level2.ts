/**
 * Live Level 2 depth for one spot pair over KuCoin's public feed.
 *
 * `/market/level2:{symbol}` only pushes *changes*, so a book built from the socket alone starts
 * empty and fills in one diff at a time. The class therefore reseeds from the REST snapshot and
 * maintains KuCoin's required calibration on top of it:
 *
 *  1. REST-First: token and initial order book REST snapshot are fetched concurrently. The UI is
 *     rendered immediately with the fresh snapshot before the socket even connects.
 *  2. Gate: each frame carries `sequenceStart`/`sequenceEnd`. A frame that ends at or before the
 *     book's sequence is stale and dropped. A frame that starts past `sequenceEnd + 1` means the
 *     stream has a gap — most critically its "size=0" deletes — so the class asks for a reseed.
 *     The frame is also applied live under per-entry sequence rules so the book never freezes.
 *  3. Buffer & replay: while a reseed's REST call is in flight, frames are held *and* applied
 *     live. Once the fresh seed lands they are replayed under the per-entry sequence rules,
 *     which skip anything the live application already covered — the heal stays lossless
 *     without ever pausing what the user sees.
 *  4. Heal & Cross Protection: whenever the book crosses itself (best bid above best ask, or ask
 *     lesser than bid — proof of stale/ghost price stall), the crossing is caught at emit time
 *     and triggers an immediate silent reseed. A periodic silent reconcile also runs every 30s.
 *
 * Merging is cheap and lossless; the throttled emit is what keeps the UI at a sane frame rate.
 */
import { request } from './client';
import { fetchBulletServers, invalidateBullet } from './socket';
import { parseLevels, type Level2Snapshot, type PriceLevel } from './orderbook';
import { compareDecimal } from '@/utils/decimal';
import { AppState } from 'react-native';

export type Level2Status = 'connecting' | 'live' | 'offline';

export type Level2Listener = {
  onSnapshot: (snapshot: Level2Snapshot) => void;
  onStatus: (status: Level2Status) => void;
};

/** How often a merged book is handed to the UI, whatever rate the socket pushes at. */
const EMIT_MS = 100;
/** Reconnect wait cap after escalating failures. */
const MAX_BACKOFF_MS = 5_000;

/**
 * A socket whose route died silently (carrier NAT drop — normal on mobile data) still reads
 * OPEN on both ends; the only honest signal is server traffic within this window.
 */
const LIVENESS_MS = 25_000;
const LIVENESS_CHECK_MS = 5_000;

/** Levels held per side, far beyond anything the UI can ever display. */
const BOOK_LIMIT = 1_000;
/** Frames held while a reseed is in flight. */
const BUFFER_LIMIT = 400;
/**
 * Minimum spacing between self-healing reseeds. Deliberately short: gapped frames are applied
 * live now, so a reseed costs nothing but one REST call, and finishing the heal inside a single
 * round trip (~200–500ms) is what keeps a consumed level from lingering long enough to be
 * mistaken for a price that is still buyable.
 */
const RESYNC_MIN_GAP_MS = 500;
/** Failed reseeds tolerated on one connection before falling back to a full reconnect. */
const RESYNC_RETRIES = 5;
/** Silent REST reconcile while the connection looks healthy. */
const RECONCILE_MS = 30_000;

function compare(a: string, b: string): number {
  return compareDecimal(a, b) ?? 0;
}

function compareToZero(value: string): number {
  return compareDecimal(value, '0') ?? 1;
}

/** Accepts the sequence number in either the REST string form or the frame number form. */
function toSequence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

type RawLevel2 = {
  sequence?: unknown;
  change?: string;
  changes?: { asks?: unknown; bids?: unknown };
  asks?: unknown;
  bids?: unknown;
  sequenceStart?: unknown;
  sequenceEnd?: unknown;
  timestamp?: number;
};

/** The REST seed for the incremental feed. Public data, so no signing. */
export async function fetchOrderBookSnapshot(symbol: string): Promise<Level2Snapshot> {
  const data = await request<{ sequence?: unknown; asks?: unknown; bids?: unknown }>(
    '/market/orderbook/level2_100',
    { query: { symbol } }
  );
  return {
    symbol,
    asks: parseLevels(data.asks),
    bids: parseLevels(data.bids),
    sequence: toSequence(data.sequence) ?? undefined,
  };
}

export class Level2Socket {
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  /** Last moment the server demonstrably answered (a data frame or a pong). */
  private lastMessageAt = 0;
  private attempt = 0;
  private stopped = true;
  private dirty = false;
  /** Sequence number of the last applied frame or seed; null until the first seed lands. */
  private bookSequence: number | null = null;
  /** Held frames while a reseed is in flight; null means live application. */
  private buffer: RawLevel2[] | null = null;
  private resyncing = false;
  private resyncAttempts = 0;
  private lastResyncAt = 0;
  private readonly asks = new Map<string, string>();
  private readonly bids = new Map<string, string>();

  constructor(
    private readonly symbol: string,
    private readonly listener: Level2Listener
  ) {}

  private appStateSubscription: { remove(): void } | null = null;

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // Android tears down cellular routes while the app is backgrounded; coming back to the
    // foreground is the natural moment to stop waiting out a long backoff and try again now.
    this.appStateSubscription?.remove();
    this.appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || this.stopped || this.reconnectTimer === null) return;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      void this.connect();
    });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.clearTimers();
    this.asks.clear();
    this.bids.clear();
    this.bookSequence = null;
    this.buffer = null;
    this.resyncing = false;
    this.resyncAttempts = 0;
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
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
    this.reconcileTimer = null;
    this.resyncTimer = null;
    this.liveTimer = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.listener.onStatus('connecting');
    this.buffer = null;
    this.resyncAttempts = 0;
    this.lastResyncAt = 0;

    // 1. Fetch token and initial order book REST snapshot concurrently (REST-First):
    const [bulletResult, snapshotResult] = await Promise.allSettled([
      fetchBulletServers(),
      fetchOrderBookSnapshot(this.symbol),
    ]);
    if (this.stopped) return;

    if (bulletResult.status === 'rejected') {
      this.scheduleReconnect();
      return;
    }
    const bullet = bulletResult.value;
    const servers = bullet.servers;
    const server = servers[this.attempt % servers.length]!;
    if (this.attempt > 0 && this.attempt % servers.length === 0) invalidateBullet();

    // 2. Deliver the initial REST snapshot to the UI immediately with zero delay:
    if (snapshotResult.status === 'fulfilled' && snapshotResult.value) {
      const snapshot = snapshotResult.value;
      if (this.stopped) return;
      this.seed(snapshot);
      this.listener.onSnapshot(this.snapshot());
    }

    // 3. Open WebSocket to stream live diffs:
    const url = `${server.endpoint}?token=${encodeURIComponent(server.token)}&pingInterval=${server.pingInterval}`;
    const socket = new WebSocket(url);
    this.socket = socket;

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
      this.lastMessageAt = Date.now();
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
        }
      }, Math.max(server.pingInterval / 2, 5_000));

      // Heartbeat: detect dead carrier NAT routes where socket stays OPEN silently
      this.liveTimer = setInterval(() => {
        if (this.stopped || socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.lastMessageAt > LIVENESS_MS) {
          socket.close();
        }
      }, LIVENESS_CHECK_MS);

      // Periodic reconcile: silent background check every 30s to prevent drift
      this.reconcileTimer = setInterval(() => {
        if (this.stopped || socket.readyState !== WebSocket.OPEN) return;
        this.requestResync();
      }, RECONCILE_MS);

      this.listener.onStatus('live');
      if (this.dirty) this.markDirty();
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (this.stopped) return;
      this.lastMessageAt = Date.now();
      const raw = String(event.data);
      if (raw === 'ping') {
        if (socket.readyState === WebSocket.OPEN) socket.send('pong');
        return;
      }
      let message: { type?: string; data?: RawLevel2 };
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.type !== 'message' || !message.data) return;

      // While a reseed is in flight the frame is both applied live and held for post-seed replay
      if (this.buffer !== null) {
        this.buffer.push(message.data);
        if (this.buffer.length > BUFFER_LIMIT) this.buffer.shift();
      }
      if (this.apply(message.data)) this.markDirty();
    };

    socket.onerror = () => {
      if (!this.stopped) this.listener.onStatus('offline');
    };

    socket.onclose = (event: WebSocketCloseEvent) => {
      this.clearTimers();
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
    this.trim();
  }

  /** Applies a REST snapshot as the book's new base, replacing everything that was there. */
  private seed(snapshot: Level2Snapshot): void {
    this.replace(snapshot.asks, snapshot.bids);
    this.bookSequence = snapshot.sequence ?? null;
  }

  private apply(data: RawLevel2): boolean {
    if (data.changes) {
      const start = toSequence(data.sequenceStart);
      const end = toSequence(data.sequenceEnd);

      // A frame whose latest covered change is already applied carries nothing new.
      if (end !== null && this.bookSequence !== null && end <= this.bookSequence) return false;

      // A frame that starts past the book's sequence means frames were missed between the two —
      // most critically its "size=0" deletes. A reseed is requested, but the frame is applied
      // anyway to keep the top of the book stepping while the heal is in flight.
      if (start !== null && this.bookSequence !== null && start > this.bookSequence + 1) {
        this.requestResync();
      }

      let changed = this.applySide(data.changes.asks, this.asks);
      if (this.applySide(data.changes.bids, this.bids)) changed = true;

      if (end !== null && (this.bookSequence === null || end > this.bookSequence)) {
        this.bookSequence = end;
      }
      return changed;
    }

    const snapshotAsks = parseLevels(data.asks);
    const snapshotBids = parseLevels(data.bids);
    if (snapshotAsks.length > 0 || snapshotBids.length > 0) {
      this.replace(snapshotAsks, snapshotBids);
      const seq = toSequence(data.sequenceEnd ?? data.sequence);
      if (seq !== null) this.bookSequence = seq;
      return true;
    }

    if (typeof data.change === 'string') return this.applyChangeString(data.change);
    return false;
  }

  /**
   * `changes` entries are `[price, size, sequence]`. Each entry's sequence is the *last*
   * modification of that price, so an entry at or before the book's sequence is a duplicate of
   * something already applied and must be ignored; the size on it is not newer.
   */
  private applySide(value: unknown, book: Map<string, string>): boolean {
    if (!Array.isArray(value)) return false;
    let changed = false;
    for (const entry of value) {
      if (!Array.isArray(entry)) continue;
      const [price, size, seq] = entry as unknown[];
      if (typeof price !== 'string' || typeof size !== 'string') continue;
      const sequence = toSequence(seq);
      if (sequence !== null && this.bookSequence !== null && sequence <= this.bookSequence) {
        continue;
      }
      if (compareToZero(size) === 0) {
        if (book.delete(price)) changed = true;
      } else {
        book.set(price, size);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * A crossed book (best bid above best ask, or asking price lesser than bidding price)
   * cannot happen on the exchange side; it only happens when a side holds levels the other side
   * has moved past — i.e. price stall or ghost orders. Treat it as a trigger for an immediate
   * reseed rather than a state the UI should render.
   */
  private isCrossed(): boolean {
    if (this.asks.size === 0 || this.bids.size === 0) return false;
    const bestAsk = this.best(this.asks, 'min');
    const bestBid = this.best(this.bids, 'max');
    if (bestAsk === null || bestBid === null) return false;
    return compare(bestBid, bestAsk) > 0;
  }

  /**
   * The v1 `change` string carries no side and no sequence, so a level already in the book is
   * updated where it lives and a new level is placed by comparing its price with the current
   * best. That matches the book the snapshot established.
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
    // No book context yet; the next resync will correct the side.
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

  /** Keeps the maps bounded by dropping the levels farthest from the best quote. */
  private trim(): void {
    if (this.asks.size > BOOK_LIMIT) {
      const prices = [...this.asks.keys()].sort((a, b) => compare(b, a)).slice(0, this.asks.size - BOOK_LIMIT);
      for (const price of prices) this.asks.delete(price);
    }
    if (this.bids.size > BOOK_LIMIT) {
      const prices = [...this.bids.keys()].sort((a, b) => compare(a, b)).slice(0, this.bids.size - BOOK_LIMIT);
      for (const price of prices) this.bids.delete(price);
    }
  }

  /**
   * Detects drift (or crossed book) and reseeds over it: frames are buffered while the REST
   * call runs so the gap is bridged without loss, then replayed under the sequence rules.
   */
  private requestResync(): void {
    if (this.stopped || this.socket === null || this.resyncing) return;
    const now = Date.now();
    if (now - this.lastResyncAt < RESYNC_MIN_GAP_MS) return;
    this.lastResyncAt = now;
    void this.resync();
  }

  private async resync(): Promise<void> {
    if (this.stopped || this.socket === null || this.resyncing) return;
    this.resyncing = true;
    if (this.buffer === null) this.buffer = [];
    const socketAtStart = this.socket;

    try {
      const snapshot = await fetchOrderBookSnapshot(this.symbol);
      if (this.stopped || this.socket !== socketAtStart) return;

      this.seed(snapshot);
      const replay = this.buffer;
      this.buffer = null;
      for (const frame of replay) {
        this.apply(frame);
      }
      this.resyncAttempts = 0;
      this.markDirty();
    } catch {
      if (this.stopped || this.socket !== socketAtStart) return;
      this.resyncAttempts += 1;
      if (this.resyncAttempts >= RESYNC_RETRIES) {
        this.socket?.close();
        return;
      }
      if (this.resyncTimer === null) {
        this.resyncTimer = setTimeout(() => {
          this.resyncTimer = null;
          void this.resync();
        }, Math.min(500 * 2 ** (this.resyncAttempts - 1), 3_000));
      }
    } finally {
      this.resyncing = false;
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.stopped || !this.dirty) return;
      this.dirty = false;
      // The crossed-book check lives at emit time: if bestBid > bestAsk (asking price lesser
      // than bidding price), heal immediately via silent reseed so stalled/ghost prices are cleared!
      if (this.isCrossed()) this.requestResync();
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
