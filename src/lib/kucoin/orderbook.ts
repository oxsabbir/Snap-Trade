/**
 * Order-book depth maths, kept pure so it can be tested without a socket or a renderer.
 *
 * Every price and size stays a decimal string and is combined with the decimal helpers, not
 * floats. The book is the one place where a wrong last digit is visible at a glance — a
 * cumulative total that drifts by a hundredth as the rows add up, or a depth bar that is a hair
 * too wide — and it is also the source of the price a user taps into the order form.
 */
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  snapToIncrement,
} from '@/utils/decimal';

export type PriceLevel = { price: string; size: string };

export type DepthRow = {
  price: string;
  size: string;
  /** Running cumulative size from the middle outward, in the base currency. */
  total: string;
  /** `total` as a share of the largest visible cumulative total, 0-100, for the depth bar. */
  percent: number;
};

export type OrderBookDepth = {
  /** Ascending by price: index 0 is the lowest ask, i.e. the row nearest the middle. */
  asks: DepthRow[];
  /** Descending by price: index 0 is the highest bid, i.e. the row nearest the middle. */
  bids: DepthRow[];
  bidPercent: number;
  askPercent: number;
};

export type Level2Snapshot = {
  symbol?: string;
  asks: PriceLevel[];
  bids: PriceLevel[];
  time?: number;
};

export const EMPTY_DEPTH: OrderBookDepth = { asks: [], bids: [], bidPercent: 50, askPercent: 50 };

/**
 * Levels shown per side. Five is what fits beside the order form without turning the book into a
 * wall of rows. It is applied *before* the cumulative walk rather than by slicing the finished
 * rows, so the totals, the bar widths and the bid/ask balance all describe exactly the levels on
 * screen. Slicing afterwards would scale the bars against a hundred levels that are not drawn, and
 * the five nearest the middle would all read as nearly empty.
 */
export const VISIBLE_LEVELS = 5;

function toLevel(entry: unknown): PriceLevel | null {
  if (Array.isArray(entry)) {
    const [price, size] = entry as [unknown, unknown];
    if (typeof price === 'string' && typeof size === 'string') return { price, size };
    return null;
  }
  if (entry && typeof entry === 'object') {
    const { price, size } = entry as { price?: unknown; size?: unknown };
    if (typeof price === 'string' && typeof size === 'string') return { price, size };
  }
  return null;
}

/** Accepts the two shapes KuCoin uses for a side: `[["p","s"], ...]` or `[{price,size}, ...]`. */
export function parseLevels(value: unknown): PriceLevel[] {
  if (!Array.isArray(value)) return [];
  const levels: PriceLevel[] = [];
  for (const entry of value) {
    const level = toLevel(entry);
    if (level) levels.push(level);
  }
  return levels;
}

/**
 * Normalizes whatever the feed produced into `{asks, bids}`. It understands the socket's own
 * snapshot type, a raw KuCoin frame (`{data: {asks, bids}}` or `{data: {changes: {...}}}`), or
 * a bare `{asks, bids}` object, so the hook works whether it is fed a parsed snapshot or the
 * message off the wire.
 */
export function parseLevel2(raw: unknown): Level2Snapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const changes =
    data.changes && typeof data.changes === 'object'
      ? (data.changes as Record<string, unknown>)
      : undefined;

  const asks = parseLevels(data.asks ?? changes?.asks ?? root.asks);
  const bids = parseLevels(data.bids ?? changes?.bids ?? root.bids);
  if (asks.length === 0 && bids.length === 0) return null;

  const symbol = typeof root.symbol === 'string' ? root.symbol : undefined;
  return { symbol, asks, bids };
}

const byPriceAsc = (a: PriceLevel, b: PriceLevel): number => Number(a.price) - Number(b.price);
const byPriceDesc = (a: PriceLevel, b: PriceLevel): number => Number(b.price) - Number(a.price);

/**
 * Groups levels into price buckets of `step` and re-sums the size in each, so a coarse view
 * does not lose the liquidity that sits between ticks. The bucket is the floor multiple of the
 * step, matching how the tick itself is drawn.
 */
export function aggregateLevels(levels: PriceLevel[], step?: string | null): PriceLevel[] {
  const live = levels.filter((level) => Number(level.size) > 0);
  if (!step || Number(step) <= 0) return live;

  const buckets = new Map<string, string>();
  for (const level of live) {
    const bucket = snapToIncrement(level.price, step, 'floor');
    if (bucket === null) continue;
    const running = buckets.get(bucket);
    buckets.set(bucket, running === undefined ? level.size : addDecimal(running, level.size) ?? running);
  }
  return [...buckets].map(([price, size]) => ({ price, size }));
}

type RunningRow = Omit<DepthRow, 'percent'>;

function cumulativeRows(levels: PriceLevel[]): RunningRow[] {
  const rows: RunningRow[] = [];
  let running = '0';
  for (const level of levels) {
    running = addDecimal(running, level.size) ?? running;
    rows.push({ price: level.price, size: level.size, total: running });
  }
  return rows;
}

function percentOf(total: string, max: string): number {
  if (compareDecimal(max, '0') !== 1) return 0;
  const ratio = divideDecimal(total, max, 6) ?? '0';
  return Math.max(0, Math.min(100, Number(ratio) * 100));
}

function sidePercent(part: string, whole: string): number {
  if (compareDecimal(whole, '0') !== 1) return 50;
  const value = Number(divideDecimal(part, whole, 6) ?? '0') * 100;
  return Math.max(0, Math.min(100, value));
}

/**
 * The full transform from a raw book to what the column renders: aggregated, sorted, trimmed to
 * the visible levels, cumulative, with each row's bar width and the buy/sell balance at the bottom.
 * Everything downstream of the trim is computed over the trimmed levels, so the numbers on screen
 * agree with each other.
 */
export function buildDepth(
  raw: unknown,
  aggregation?: string | null,
  maxLevels: number = VISIBLE_LEVELS
): OrderBookDepth {
  const snapshot = parseLevel2(raw);
  if (!snapshot) return EMPTY_DEPTH;

  const limit = Math.max(0, Math.floor(maxLevels));
  // Aggregate first, then trim: a coarse step can fold several raw levels into one bucket, and
  // trimming first would leave the visible rows short of the level count we asked for.
  const asks = aggregateLevels(snapshot.asks, aggregation).sort(byPriceAsc).slice(0, limit);
  const bids = aggregateLevels(snapshot.bids, aggregation).sort(byPriceDesc).slice(0, limit);

  const askRows = cumulativeRows(asks);
  const bidRows = cumulativeRows(bids);

  const askTotal = askRows.length > 0 ? askRows[askRows.length - 1]!.total : '0';
  const bidTotal = bidRows.length > 0 ? bidRows[bidRows.length - 1]!.total : '0';
  const max = (compareDecimal(askTotal, bidTotal) ?? 0) >= 0 ? askTotal : bidTotal;

  const sum = addDecimal(askTotal, bidTotal) ?? '0';
  const bidPercent = sidePercent(bidTotal, sum);

  return {
    asks: askRows.map((row) => ({ ...row, percent: percentOf(row.total, max) })),
    bids: bidRows.map((row) => ({ ...row, percent: percentOf(row.total, max) })),
    bidPercent,
    askPercent: 100 - bidPercent,
  };
}

/** The aggregation steps offered for a pair: its tick, then ×10, ×100 and ×1000. */
export function aggregationOptions(tickSize: string): string[] {
  const steps = [tickSize];
  let current = tickSize;
  for (let index = 0; index < 3; index += 1) {
    const next = multiplyDecimal(current, '10');
    if (!next) break;
    current = next;
    steps.push(next);
  }
  return steps;
}
