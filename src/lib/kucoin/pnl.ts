/**
 * Account PnL over a calendar window (Today / Week / Month / All).
 *
 * KuCoin's spot API has no account-level PnL endpoint, but the pieces it does expose are
 * enough to build the number KuCoin's own asset card shows: the portfolio's value change over
 * the window, minus the money the user moved onto or off the exchange themselves:
 *
 *   pnl = current − baseline − depositsUSD + withdrawalsUSD
 *
 * Without the flow correction, funding the account would read as pure profit. Deposits and
 * withdrawals come from the signed v1 ledger endpoints (`/deposits`, `/withdrawals`) in the
 * coin they moved; a short-tail coin like KCS is priced with the same USDT/BTC index the
 * portfolio builder uses, from one shared (60s-cached) ticker snapshot.
 */
import { request } from './client';
import { fetchAllTickers } from './market';
import type { AllTickersResponse, Ticker } from './types';
import { buildPriceIndex, unitPrice, type PriceIndex } from './portfolio';
import {
  earliestSnapshot,
  snapshotAfter,
  snapshotBefore,
  type PortfolioSnapshot,
} from '@/state/portfolioHistory';

export type PnlRange = 'today' | 'week' | 'month' | 'all';

export type PnlReading = {
  /** Corrected USD PnL; null when the window has no baseline to measure against yet. */
  change: number | null;
  /** Change against the assets present at the window start (baseline plus the flow). */
  percent: number | null;
  /** Amount the user moved in minus moved out, over the window. Shown as a footnote. */
  flow: number;
  loading: boolean;
};

type LedgerEntry = { currency: string; amount: number };

const LEDGER_MAX_PAGES = 5;

/** Local midnight-based boundaries, matching how the tabs read ("today", "this month"). */
export function startOfRange(
  range: PnlRange,
  now: number = Date.now(),
): number | null {
  const date = new Date(now);
  switch (range) {
    case 'today':
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    case 'week':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'month': {
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    case 'all':
      return null; // Anchor point is the earliest snapshot, decided by the caller's history.
  }
}

/** The value the window is measured from: last reading before it, or the first one inside. */
export function baselineSnapshot(
  range: PnlRange,
  history: readonly PortfolioSnapshot[],
): PortfolioSnapshot | null {
  if (history.length === 0) return null;
  if (range === 'all') return history[0] ?? null;
  const start = startOfRange(range);
  if (start === null) return null;
  return snapshotBefore(start) ?? snapshotAfter(start);
}

// --- Pricing ---

let priceIndexCache: { at: number; index: PriceIndex } | null = null;
const PRICE_INDEX_TTL_MS = 60_000;

/**
 * One ticker round-trip shared by every PnL lookup in the minute after it lands. Tickers also
 * feed the portfolio total on the account screen, so a fresh cache is fine, never stale.
 */
async function priceIndex(): Promise<PriceIndex> {
  if (priceIndexCache && Date.now() - priceIndexCache.at < PRICE_INDEX_TTL_MS) {
    return priceIndexCache.index;
  }
  const list: AllTickersResponse = await fetchAllTickers();
  const index = buildPriceIndex(list.ticker);
  priceIndexCache = { at: Date.now(), index };
  return index;
}

function refreshPriceIndexCache(tickers: Ticker[]): void {
  priceIndexCache = { at: Date.now(), index: buildPriceIndex(tickers) };
}

// --- Deposits & withdrawals ledger ---

type LedgerPage = {
  currentPage?: unknown;
  totalPage?: unknown;
  items?: unknown;
};

function isSuccessfulResult(status: unknown): boolean {
  return typeof status === 'string' && status.toUpperCase().includes('SUCCESS');
}

/** Amount plus currency pairs from a KuCoin ledger row; nothing without both is usable. */
function toLedgerEntry(raw: unknown): LedgerEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isSuccessfulResult(r.status)) return null;
  const currency = typeof r.currency === 'string' ? r.currency : null;
  const amount =
    typeof r.amount === 'number'
      ? r.amount
      : typeof r.amount === 'string'
        ? Number(r.amount)
        : NaN;
  if (!currency || !Number.isFinite(amount)) return null;
  return { currency, amount };
}

/**
 * Walks one of the two ledger endpoints page by page up to a sane cap. Deposits and
 * withdrawals scale with how active the user is, so a bound keeps worst-case requests short;
 * a page cap shows up as a slightly short correction, never as a wrong sign.
 */
async function fetchLedger(
  path: 'deposits' | 'withdrawals',
  startAt: number,
): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  let page = 1;
  while (page <= LEDGER_MAX_PAGES) {
    const data = await request<LedgerPage | unknown[]>(`${path}`, {
      signed: true,
      query: { startAt, pageSize: 100, currentPage: page },
    });
    const payload: LedgerPage = Array.isArray(data) ? { items: data } : data;
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const raw of items) {
      const entry = toLedgerEntry(raw);
      if (entry) out.push(entry);
    }
    const totalPage =
      typeof payload.totalPage === 'number' ? payload.totalPage : 1;
    const currentPage =
      typeof payload.currentPage === 'number' ? payload.currentPage : page;
    if (page >= totalPage || currentPage >= totalPage) break;
    page += 1;
  }
  return out;
}

/** Value of a ledger entry in USD, using the shared price index (0 when unpriceable). */
function entryValue(entry: LedgerEntry, index: PriceIndex): number {
  return entry.amount * unitPrice(entry.currency, index);
}

/**
 * Net money the user moved onto the exchange over the window: deposits minus withdrawals.
 * A positive flow means the window's asset growth is partly new money, not PnL.
 */
export async function fetchNetFlowUsd(startAt: number): Promise<number> {
  const [deposits, withdrawals] = await Promise.all([
    fetchLedger('deposits', startAt),
    fetchLedger('withdrawals', startAt),
  ]);
  const index = await priceIndex();
  return (
    deposits.reduce((sum, entry) => sum + entryValue(entry, index), 0) -
    withdrawals.reduce((sum, entry) => sum + entryValue(entry, index), 0)
  );
}

/**
 * Computes the reading for one window. The caller seeds the ticker cache from the portfolio
 * fetch it already drives, so a cold tab usually needs no extra public round-trip at all.
 */
export async function computePnlReading(
  range: PnlRange,
  currentTotal: number,
  history: readonly PortfolioSnapshot[],
  tickers?: Ticker[],
  seedFlowCache?: Map<PnlRange, number>,
): Promise<PnlReading> {
  if (tickers) refreshPriceIndexCache(tickers);
  const baseline = baselineSnapshot(range, history);
  if (!baseline) {
    return { change: null, percent: null, flow: 0, loading: false };
  }

  const flowStart =
    range === 'all' ? baseline.t : startOfRange(range) ?? baseline.t;
  let flow: number | undefined = seedFlowCache?.get(range);
  if (flow === undefined) {
    flow = await fetchNetFlowUsd(flowStart);
    seedFlowCache?.set(range, flow);
  }

  const change = currentTotal - baseline.v - flow;
  const baseAssets = baseline.v + flow;
  const percent = baseAssets > 0 ? (change / baseAssets) * 100 : null;
  return { change, percent, flow, loading: false };
}

/**
 * Seeds the module price cache and returns the shared flow cache the account tab can hold
 * across tab switches for the lifetime of the screen.
 */
export function createFlowCache(): Map<PnlRange, number> {
  return new Map();
}

/** Exposed for tests and callers that want the "All" anchor without recomputing. */
export function allRangeBaseline(): PortfolioSnapshot | null {
  return earliestSnapshot();
}
