import { request } from './client';
import type { Candle, CandleTuple } from './types';

export const TIMEFRAMES = [
  { key: '1min', label: '1m', seconds: 60 },
  { key: '5min', label: '5m', seconds: 300 },
  { key: '15min', label: '15m', seconds: 900 },
  { key: '1hour', label: '1H', seconds: 3600 },
  { key: '4hour', label: '4H', seconds: 14400 },
  { key: '1day', label: '1D', seconds: 86400 },
  { key: '1week', label: '1W', seconds: 604800 },
] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

/**
 * Not a KuCoin candle type. It is not in `TIMEFRAMES` deliberately: there is no
 * `seconds` bucket to roll over, it is fetched by paging `endAt` rather than in one
 * call, and it renders as a line rather than candles. Keeping it separate stops those
 * differences leaking into the timeframe math.
 */
export const LINE_TIMEFRAME = { key: 'line', label: 'Line' } as const;

export type TimeframeOrLine = Timeframe | typeof LINE_TIMEFRAME;

export function timeframeByKey(key: string): TimeframeOrLine {
  if (key === LINE_TIMEFRAME.key) return LINE_TIMEFRAME;
  // Unknown keys fall back to a real timeframe, not to LINE_TIMEFRAME: a stray key
  // should not trigger a multi-page lifetime fetch.
  return TIMEFRAMES.find((t) => t.key === key) ?? TIMEFRAMES[0];
}

function toCandle(row: CandleTuple): Candle {
  return {
    time: row[0] * 1000,
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]),
    turnover: Number(row[6]),
  };
}

/**
 * KuCoin returns candles newest-first, capped at 100 per call, with second-precision
 * timestamps. We flip to oldest-first so the chart reads left to right.
 *
 * `endAt` is in seconds and is how the lifetime walk pages backwards. It does not raise
 * the 100-row cap; it only moves the window.
 */
export async function fetchCandles(
  symbol: string,
  type: string,
  endAt?: number
): Promise<Candle[]> {
  const rows = await request<CandleTuple[]>('/market/candles', {
    query: endAt === undefined ? { symbol, type } : { symbol, type, endAt },
  });
  return rows.map(toCandle).reverse();
}

/** Rows per `/market/candles` call. Also the short-page test that ends the walk. */
const CANDLES_PER_PAGE = 100;

/**
 * Bucket size for the lifetime line. Weekly is deliberate: the walk costs 100 candles
 * per request, so 1min would need thousands of requests to reach a listing date, while
 * 1week covers any real listing in a handful of calls.
 */
const LINE_BUCKET_TYPE = '1week';

/** 12 pages of weekly candles is ~23 years, well beyond any listing. A safety net. */
const MAX_LINE_PAGES = 12;

/**
 * Walks `endAt` backwards from now to build the whole available history.
 *
 * Relies on a measured property of the endpoint: pages are adjacent — one page's oldest
 * row is exactly 100 buckets before the next page's newest, so the paging itself
 * introduces no holes or overlaps. A page shorter than `CANDLES_PER_PAGE` means we have
 * walked past the listing date. The walk is sequential because each `endAt` depends on
 * the previous page's oldest row.
 *
 * The underlying series is not perfectly regular, though: BTC-USDT has no weekly candle
 * at all for the week of 2017-11-02, even though 1-day candles prove trading happened
 * that week. The gap is in the source data, not the paging. It is one week in 466 points
 * and the chart is index-spaced, so it is not visible.
 *
 * Returns oldest-first, matching every other series in the app.
 */
export async function fetchLineSeries(
  symbol: string,
  onPage?: (pages: number) => void
): Promise<Candle[]> {
  const collected: Candle[] = [];
  const seen = new Set<number>();
  let endAt = Math.floor(Date.now() / 1000);

  for (let page = 0; page < MAX_LINE_PAGES; page++) {
    const rows = await request<CandleTuple[]>('/market/candles', {
      query: { symbol, type: LINE_BUCKET_TYPE, endAt },
    });
    onPage?.(page + 1);

    // Newest-first from the API; walk it backwards so the page is oldest-first, then
    // prepend, since later pages are older than earlier ones.
    const points: Candle[] = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row) continue;
      const candle = toCandle(row);
      // Pages are contiguous, so this should never fire. Cheap insurance against an
      // off-by-one at a page boundary producing a doubled point.
      if (seen.has(candle.time)) continue;
      seen.add(candle.time);
      points.push(candle);
    }
    collected.unshift(...points);

    if (rows.length < CANDLES_PER_PAGE) break;
    const oldest = rows[rows.length - 1];
    if (!oldest) break;
    endAt = Number(oldest[0]) - 1;
  }

  return collected;
}

