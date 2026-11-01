/**
 * Today's realized spot PnL, read from KuCoin's own fill records (`GET /fills`).
 *
 * KuCoin's spot API has no PnL endpoint, but fills carry everything needed: each sell releases
 * inventory at its current average buy cost (fees converted into quote value), and that
 * difference is realized PnL. Buys made before the window matter when their inventory is sold
 * today, so each traded symbol backfills history ending at local midnight — conservatively
 * capped, where "unknown basis" sells contribute zero and the result is flagged `partial`,
 * never inflated.
 *
 * Memoized for a minute; the Price index used to convert odd currencies is seeded by the
 * account fetch's tickers via `seedPriceIndex`.
 */
import { fetchFills, type Fill } from './fills';
import { fetchAllTickers } from './market';
import type { AllTickersResponse, Ticker } from './types';
import { buildPriceIndex, unitPrice, type PriceIndex } from './portfolio';

export type PnlToday = {
  /** Realized PnL in USD-equivalent value; null until the scan completes (or it fails). */
  change: number | null;
  /** Pre-midnight history hit the backfill cap — some cost basis unknown. */
  partial: boolean;
};

/** Today's account-wide scan cap (100 fills per page). */
const TODAY_PAGES = 5;
/** Pages walked back per traded symbol to rebuild inventory held at midnight. */
const BACKFILL_PAGES = 4;
const PAGE_SIZE = 100;
/** Parallelism cap for per-symbol backfills, to stay polite to the rate pool. */
const BACKFILL_CONCURRENCY = 4;
const TTL_MS = 60_000;

let cached: { at: number; task: Promise<PnlToday> } | null = null;

let priceIndexCache: { at: number; index: PriceIndex } | null = null;
const PRICE_INDEX_TTL_MS = 60_000;

export function seedPriceIndex(tickers: Ticker[]): void {
  priceIndexCache = { at: Date.now(), index: buildPriceIndex(tickers) };
}

async function priceIndex(): Promise<PriceIndex> {
  if (priceIndexCache && Date.now() - priceIndexCache.at < PRICE_INDEX_TTL_MS) {
    return priceIndexCache.index;
  }
  const list: AllTickersResponse = await fetchAllTickers();
  const index = buildPriceIndex(list.ticker);
  priceIndexCache = { at: Date.now(), index };
  return index;
}

function startOfToday(now: number = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const quoteOf = (symbol: string): string =>
  symbol.slice(symbol.lastIndexOf('-') + 1);

/** Converts a fill's fee into the symbol's quote currency (0 when unpriceable). */
function feeInQuote(fill: Fill, price: PriceIndex): number {
  const amount = Number(fill.fee);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const quote = quoteOf(fill.symbol);
  if (fill.feeCurrency === quote) return amount;
  if (fill.feeCurrency === fill.symbol.slice(0, fill.symbol.indexOf('-'))) {
    const unit = Number(fill.price);
    return Number.isFinite(unit) ? amount * unit : 0;
  }
  return fill.feeCurrency ? amount * unitPrice(fill.feeCurrency, price) : 0;
}

type Position = {
  /** Base units currently held. */
  size: number;
  /** Combined quote cost — the average-cost basis sells release against. */
  cost: number;
  /** Base units ever sold without known inventory — the `partial` signal. */
  unknownSold: number;
};

const emptyPosition = (): Position => ({ size: 0, cost: 0, unknownSold: 0 });

/**
 * Replays one fill against its symbol's position. Buys extend inventory (quote value + fee)
 * and return null; sells return realized PnL, with an over-run sell contributing zero.
 */
function apply(pos: Position, fill: Fill, price: PriceIndex): number | null {
  const unit = Number(fill.price);
  const size = Number(fill.size);
  const fee = feeInQuote(fill, price);
  if (!Number.isFinite(unit) || !Number.isFinite(size) || size <= 0) return null;

  if (fill.side === 'buy') {
    const value = Number(fill.funds);
    const cost = (Number.isFinite(value) && value > 0 ? value : unit * size) + fee;
    pos.cost += cost;
    pos.size += size;
    return null;
  }

  const value = Number(fill.funds);
  const proceeds = (Number.isFinite(value) && value > 0 ? value : unit * size) - fee;
  if (!Number.isFinite(proceeds)) return null;
  if (pos.size <= 0) {
    pos.unknownSold += size;
    return null;
  }
  const sold = Math.min(pos.size, size);
  const basis = (pos.cost / pos.size) * sold;
  pos.size -= sold;
  pos.cost -= basis;
  if (sold < size) pos.unknownSold += size - sold;
  return proceeds - basis;
}

/** Pages of /fills, newest-first; returned in chronological (oldest-first) replay order. */
async function fetchBackward(symbol: string | null, maxPages: number, startAt?: number, endAt?: number): Promise<Fill[]> {
  const out: Fill[] = [];
  let page = 1;
  while (page <= maxPages) {
    const result = await fetchFills(symbol, { page, startAt, endAt, pageSize: PAGE_SIZE });
    out.push(...result.items);
    if (!result.hasMore) break;
    page += 1;
  }
  return out.reverse();
}

function dedupe(fills: Fill[]): Fill[] {
  const seen = new Set<string>();
  return fills.filter((fill) => (seen.has(fill.tradeId) ? false : (seen.add(fill.tradeId), true)));
}

async function computeTodayPnl(index: PriceIndex): Promise<PnlToday> {
  const midnight = startOfToday();
  const todayFills = dedupe(await fetchBackward(null, TODAY_PAGES, midnight));
  if (todayFills.length === 0) {
    return { change: 0, partial: false };
  }

  // Buys made before today are invisible to the account-wide pull, yet their inventory is
  // what today's sells release — so each traded symbol gets its own history ending at
  // midnight and is replayed from a clean position.
  const tradedSymbols = [...new Set(todayFills.filter((f) => f.side === 'sell').map((f) => f.symbol))];
  const backfilled = new Map<string, Fill[]>();
  for (let i = 0; i < tradedSymbols.length; i += BACKFILL_CONCURRENCY) {
    await Promise.all(
      tradedSymbols.slice(i, i + BACKFILL_CONCURRENCY).map(async (symbol) => {
        try {
          backfilled.set(symbol, dedupe(await fetchBackward(symbol, BACKFILL_PAGES, undefined, midnight)));
        } catch {
          // Backfill failure degrades the symbol to partial accounting, never the reading.
        }
      }),
    );
  }

  let realized = 0;
  let partial = false;
  for (const symbol of tradedSymbols) {
    const pos = emptyPosition();
    for (const fill of dedupe([
      ...(backfilled.get(symbol) ?? []),
      ...todayFills.filter((f) => f.symbol === symbol),
    ])) {
      const gain = apply(pos, fill, index);
      if (gain !== null) realized += gain;
    }
    if (pos.unknownSold > 0) partial = true;
  }

  return { change: realized, partial };
}

/**
 * Today's reading, memoized for a minute so revisiting the tab (or the 30s account poll)
 * reuses the settled result instead of rescanning history.
 */
export function fetchTodayPnl(): Promise<PnlToday> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.task;

  const task = (async () => {
    const index = await priceIndex();
    return computeTodayPnl(index);
  })();
  const entry = { at: Date.now(), task };
  cached = entry;
  task.catch(() => {
    if (cached === entry) cached = null;
  });
  return task;
}
