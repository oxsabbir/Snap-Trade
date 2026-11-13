/**
 * Live order-book depth for one spot pair, carried on the app's single public WebSocket
 * (`publicSocket.ts`) instead of a per-screen connection.
 *
 * The class subscribes to `/spotMarket/level2Depth50:{symbol}`, which pushes the 50 best
 * asks and bids as *full snapshots* every 100ms whenever the market moves. That removes the
 * entire calibration machinery the old `/market/level2` change-feed required — no REST seed,
 * no sequence gating, no gap buffer, no resync: every incoming frame replaces the book, and
 * the throttle on delivery is all that remains (the UI renders at most one book per 100ms
 * anyway).
 *
 * The tradeoff is span: the top 50 levels per side is a few percent of price on liquid
 * pairs, but the UI draws 5 rows per side (split) or 10 (single-sided) — always well inside
 * the feed. Symbol switches are topic changes on the shared connection; nothing dials.
 *
 * One deliberate borrow from the pre-Depth50 design: the REST snapshot still seeds the book
 * in parallel with the connection. The depth channel pushes only when the market moves, so
 * without a seed a slow-moving pair shows an empty (not a stale) book at cold start — and
 * an immediately-visible price is worth more than the half-second the seed can be slightly
 * stale for on a fast market. Each Depth50 frame replaces the book, so the seed's authority
 * ends at the first market change.
 */
import { request } from './client';
import { subscribeTopic, type PublicTopicMessage } from './publicSocket';
import { parseLevels, type Level2Snapshot, type PriceLevel } from './orderbook';
import { socketLog } from './socketLog';

export type Level2Status = 'connecting' | 'live' | 'offline';

export type Level2Listener = {
  onSnapshot: (snapshot: Level2Snapshot) => void;
  onStatus: (status: Level2Status) => void;
};

/** How often a book is handed to the UI, whatever rate the socket pushes at. */
const EMIT_MS = 100;

function topicOf(symbol: string): string {
  return `/spotMarket/level2Depth50:${symbol}`;
}

type DepthPayload = {
  asks?: unknown;
  bids?: unknown;
  timestamp?: unknown;
};

/** The REST seed remains available for callers that want an explicit book snapshot. */
export async function fetchOrderBookSnapshot(symbol: string): Promise<Level2Snapshot> {
  const data = await request<{ sequence?: unknown; asks?: unknown; bids?: unknown }>(
    '/market/orderbook/level2_100',
    { query: { symbol } }
  );
  const toSequence = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };
  return {
    symbol,
    asks: parseLevels(data.asks),
    bids: parseLevels(data.bids),
    sequence: toSequence(data.sequence) ?? undefined,
  };
}

export class Level2Socket {
  /** Defines the scope of delivery: frames from one session never outlive their instance. */
  private readonly session = Symbol('level2-session');
  private release: (() => void) | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private deliveredFirstFrame = false;
  private bookTime = 0;
  private readonly asks = new Map<string, string>();
  private readonly bids = new Map<string, string>();

  constructor(
    private readonly symbol: string,
    private readonly listener: Level2Listener
  ) {}

  start(): void {
    if (this.release) return;
    const session = this.session;

    this.release = subscribeTopic(topicOf(this.symbol), {
      onMessage: (message: PublicTopicMessage) => {
        if (this.session !== session || !this.release) return;
        if (message.subject !== 'level2' || !message.data) return;
        const depth = message.data as DepthPayload;
        const asks = parseLevels(depth.asks);
        const bids = parseLevels(depth.bids);
        if (asks.length === 0 && bids.length === 0) return;

        if (!this.deliveredFirstFrame) {
          // Provenance of the first frame (warm vs fresh dial) is logged by the shared socket
          // manager now — this instance only tracks it for the REST-seed handoff below.
          this.deliveredFirstFrame = true;
        }
        this.replace(asks, bids);
        if (typeof depth.timestamp === 'number') this.bookTime = depth.timestamp;
        this.markDirty();
      },
      onStatus: (status: Level2Status) => {
        if (this.session !== session) return;
        this.listener.onStatus(status);
      },
    });

    // REST seed in parallel with the connection, same as the pre-Depth50 design: the depth
    // channel only pushes when the market moves, so on a slow-moving pair the first socket
    // frame can be seconds away and the user would stare at an empty book while a perfectly
    // actionable REST snapshot is one round trip off — the paint-first edge that made early
    // orders possible. The seed applies only when the socket has not yet delivered anything,
    // and every Depth50 frame replaces the whole book wholesale, so a seed that just survived
    // being slightly stale is overwritten within one market change — no sequence gating, no
    // buffer, no resync needed.
    void fetchOrderBookSnapshot(this.symbol)
      .then((snapshot) => {
        // Discarded if this instance moved on, was stopped, or the stream is already live —
        // in every such case a frame (never the seed) is the book's authority now.
        if (this.session !== session || !this.release || this.deliveredFirstFrame) return;
        socketLog('book:rest-seed', this.symbol);
        this.replace(snapshot.asks, snapshot.bids);
        this.bookTime = Date.now();
        this.markDirty();
      })
      .catch(() => {
        // No seed is survivable: the depth channel will paint on the next market change.
      });
  }

  stop(): void {
    this.release?.();
    this.release = null;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.dirty = false;
    // Drop a book that was merged but not yet emitted, so a stopped view cannot deliver the
    // previous pair's depth into whatever view has moved on.
    this.asks.clear();
    this.bids.clear();
    this.bookTime = 0;
    this.deliveredFirstFrame = false;
  }

  private replace(asks: PriceLevel[], bids: PriceLevel[]): void {
    this.asks.clear();
    this.bids.clear();
    for (const level of asks) this.asks.set(level.price, level.size);
    for (const level of bids) this.bids.set(level.price, level.size);
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.listener.onSnapshot(this.snapshot());
    }, EMIT_MS);
  }

  private snapshot(): Level2Snapshot {
    return {
      symbol: this.symbol,
      asks: [...this.asks].map(([price, size]) => ({ price, size })),
      bids: [...this.bids].map(([price, size]) => ({ price, size })),
      time: this.bookTime || Date.now(),
    };
  }
}
