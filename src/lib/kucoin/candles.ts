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

export function timeframeByKey(key: string): Timeframe {
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
 */
export async function fetchCandles(symbol: string, type: string): Promise<Candle[]> {
  const rows = await request<CandleTuple[]>('/market/candles', {
    query: { symbol, type },
  });
  return rows.map(toCandle).reverse();
}

export function priceExtremes(candles: Candle[]): { low: number; high: number } {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const candle of candles) {
    if (candle.low < low) low = candle.low;
    if (candle.high > high) high = candle.high;
  }
  return { low, high };
}
