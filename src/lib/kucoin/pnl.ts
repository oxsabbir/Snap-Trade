/**
 * Account PnL over a calendar window (Today / Week / Month / All).
 *
 * KuCoin's spot API has no account-level PnL endpoint, so this builds the number from the
 * records KuCoin *does* export: the signed `GET /fills` trade history. Every fill belongs to
 * the account, arrives regardless of when the app was installed, and carries price/size/funds/
 * fee — enough to reconstruct realized spot trading PnL exactly the way an exchange does:
 *
 *   per fill, buys grow one average-cost inventory position per symbol,
 *   sells release inventory at its current average cost, and the difference between the
 *   proceeds and that cost — after converting fees into quote value — is realized PnL.
 *
 * For a window (Today/Week/Month), trades made *before* the window still matter when their
 * inventory is sold inside it, so the engine backfills each traded symbol from pages ending at
 * the window start. A committed backfill cap keeps worst-case request counts bounded; symbols
 * whose history is deeper than the cap behave conservatively (unknown-cost sells contribute
 * zero and the reading is flagged `partial`, so it can never inflate).
 */
import {
  fetchFills,
  type Fill,
} from './fills';
import { fetchAllTickers } from './market';
import type { AllTickersResponse, Ticker } from './types';
import { buildPriceIndex, unitPrice, type PriceIndex } from './portfolio';

export type PnlRange = 'today' | 'week' | 'month' | 'all';

export type PnlReading = {
  /** Realized spot trading PnL converted to USD-equivalent value; null while computing. */
  change: number | null;
  /** Window sells that released known inventory (completed round trips). */
  trades: number;
  /** A traded symbol's pre-window history hit its backfill cap — some cost basis unknown. */
  partial: boolean;
};

/** Account-wide scan page count per range (100 fills per page on KuCoin's /fills). */
const WINDOW_PAGES: Record<PnlRange, number> = {
  today: 5,
  week: 10,
  month: 20,
  all: 60,
};

/** Pages walked backwards per traded symbol to rebuild inventory from before the window. */
const BACKFILL_PAGES = 4;

const PAGE_SIZE = 100;
/** Parallelism cap for per-symbol backfills, to stay polite to the Management rate pool. */
const BACKFILL_CONCURRENCY = 4;
const RANGE_TTL_MS = 60_000;

type CachedReading = { at: number; reading: Promise<PnlReading> };

const cache = new Map<PnlRange, CachedReading>();

/**
 * Prices for converting fees charged in a third currency (and e.g. fees in a base we need as
 * quote value). Seeded from the tickers the account fetch already produced so a cold tab
 * usually needs no extra public round-trip.
 */
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

/** Local-calendar boundaries; "All" starts at epoch 0 since fills give us full history. */
export function startOfRange(range: PnlRange, now: number = Date.now()): number {
  const date = new Date(now);
  switch (range) {
    case 'today':
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    case 'week':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'month':
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    case 'all':
      return 0;
  }
}

/**
 * One average-cost position per symbol, quoted in the symbol's quote currency. Buy fees and
 * sell fees are folded in at quote value, exactly how a realized-PnL ledger must treat them.
 */
type Position = {
  /** Base units currently held. */
  size: number;
  /** Quote cost of those units — combined average-cost basis for sells. */
  cost: number;
  /** Rough base units ever sold without known inventory — the `partial` signal. */
  unknownSold: number;
};

function quoteOf(symbol: string): string {
  const index = symbol.lastIndexOf('-');
  return index >= 0 ? symbol.slice(index + 1) : symbol;
}

/** Converts one fill's fee into the symbol's quote currency (or 0 when unpriceable). */
function feeInQuote(fee: Fill, price: PriceIndex): number {
  const amount = Number(fee.fee);
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const currency = fee.feeCurrency;
  if (currency === quoteOf(fee.symbol)) return amount;
  if (currency === fee.symbol.slice(0, fee.symbol.indexOf('-'))) {
    const unit = Number(fee.price);
    return Number.isFinite(unit) ? amount * unit : 0;
  }
  if (!currency) return 0;
  return amount * unitPrice(currency, price);
}

/**
 * Replays one fill against the position. Buys extend inventory (quote value + fee). Sells
 * return the released inventory's realized PnL; a sell that out-runs known inventory earns 0
 * and marks the position partial rather than being booked at the full proceeds.
 */
/**
 * Replays one fill against the position. Buys extend inventory (quote value + fee) and return
 * null. Sells return the released inventory's realized PnL; a sell that out-runs known
 * inventory earns 0 and marks the position partial rather than being booked at full proceeds.
 */
function apply(pos: Position, fill: Fill, price: PriceIndex): number | null {
  const unit = Number(fill.price);
  const size = Number(fill.size);
  const fee = feeInQuote(fill, price);
  if (!Number.isFinite(unit) || !Number.isFinite(size) || size <= 0) return null;

  if (fill.side === 'buy') {
    const value = Number(fill.funds);
    const cost = (Number.isFinite(value) && value > 0 ? value : unit * size) + fee;
    // Average-cost accounting: extend the position, blend the cost into the basis.
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

/** Pages of /fills, newest-first; reversed into chronological order for replay. */
async function fetchBackward(
  symbol: string | null,
  maxPages: number,
  startAt?: number,
  endAt?: number,
): Promise<Fill[]> {
  const out: Fill[] = [];
  let page = 1;
  while (page <= maxPages) {
    const result = await fetchFills(symbol, {
      page,
      startAt,
      endAt,
      pageSize: PAGE_SIZE,
    });
    out.push(...result.items);
    if (!result.hasMore) break;
    page += 1;
  }
  return out.reverse();
}

function dedupe(sorted: Fill[]): Fill[] {
  const seen = new Set<string>();
  const out: Fill[] = [];
  for (const fill of sorted) {
    const key = `${fill.tradeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fill);
  }
  return out;
}

const emptyPosition = (): Position => ({ size: 0, cost: 0, unknownSold: 0 });

/**
 * The reading for one range: one account-wide `/fills` scan since the window start, then a
 * per-symbol backtrack to rebuild the inventory each window sell released, then one exact
 * average-cost replay per traded symbol.
 */
async function computeReading(
  range: PnlRange,
  index: PriceIndex,
): Promise<PnlReading> {
  const startAt = startOfRange(range);

  // Buys and sells inside the window, account-wide (the API returns newest first, so it is
  // reversed into chronological replay order).
  const windowFills = dedupe(
    await fetchBackward(null, WINDOW_PAGES[range], startAt || undefined),
  );
  if (windowFills.length === 0) {
    return { change: 0, trades: 0, partial: false };
  }

  // Buys made before the window are invisible to the account-wide pull, yet their inventory
  // is what the window's sells release — so each traded symbol gets its own history fetched
  // with a boundary at the window start and replayed from a clean position.
  const tradedSymbols = [...new Set(windowFills.filter((f) => f.side === 'sell').map((f) => f.symbol))];
  const backfilled = new Map<string, Fill[]>();
  for (let i = 0; i < tradedSymbols.length; i += BACKFILL_CONCURRENCY) {
    const batch = tradedSymbols.slice(i, i + BACKFILL_CONCURRENCY);
    await Promise.all(
      batch.map(async (symbol) => {
        try {
          backfilled.set(symbol, dedupe(await fetchBackward(symbol, BACKFILL_PAGES, undefined, startAt)));
        } catch {
          // Backfill failure degrades the symbol to partial accounting; it never blocks the
          // whole reading.
        }
      }),
    );
  }

  let realized = 0;
  let trades = 0;
  let partial = false;
  for (const symbol of tradedSymbols) {
    const pos = emptyPosition();
    let soldCount = 0;
    for (const fill of dedupe([
      ...(backfilled.get(symbol) ?? []),
      ...windowFills.filter((f) => f.symbol === symbol),
    ])) {
      // Buys only build inventory — apply() returns null for them; sells return realized gain.
      const gain = apply(pos, fill, index);
      if (gain !== null) {
        realized += gain;
        soldCount += 1;
      }
    }
    trades += soldCount;
    if (pos.unknownSold > 0) partial = true;
  }

  return { change: realized, trades, partial };
}

/**
 * The reading for one range, memoized for a minute so switching tabs (or coming back to the
 * screen) reuses the same in-flight or settled result instead of re-scanning history.
 */
export function pnlReading(range: PnlRange): Promise<PnlReading> {
  const hit = cache.get(range);
  if (hit && Date.now() - hit.at < RANGE_TTL_MS) return hit.reading;

  const task = (async () => {
    const index = await priceIndex();
    return computeReading(range, index);
  })();
  const entry: CachedReading = { at: Date.now(), reading: task };
  cache.set(range, entry);
  task.catch(() => {
    if (cache.get(range) === entry) cache.delete(range);
  });
  return task;
}

/** Best for tab switches: the last computed reading before its cache entry expires. */
export function cachedPnlReading(range: PnlRange): Promise<PnlReading> | null {
  const hit = cache.get(range);
  return hit && Date.now() - hit.at < RANGE_TTL_MS ? hit.reading : null;
}
