import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchLineSeries } from '@/lib/kucoin/candles';
import type { TickerUpdate } from '@/lib/kucoin/socket';
import type { Candle } from '@/lib/kucoin/types';

/**
 * Lifetime series are expensive relative to a single candle page — 1 to 5 requests,
 * sequentially — and a user flicking between the timeframe tabs would otherwise refetch
 * the same multi-year walk on every pass. Keyed by symbol, since the series is a pure
 * function of it. `refresh` deletes the entry so it genuinely refetches.
 */
const cache = new Map<string, Candle[]>();

/** Shared empty reference, so an idle hook does not hand a fresh array to the chart. */
const EMPTY: Candle[] = [];

/**
 * Picks the series to render: the freshly loaded one if there is any, otherwise the cached
 * one, otherwise nothing.
 *
 * A cache hit is served straight from the map. The fetch effect deliberately returns early
 * for a cached symbol, and the render-phase reset empties `series`, so without this the
 * cached array would never be restored and a second visit to the Line tab would render an
 * empty chart forever.
 *
 * Exported for tests, since the hook cannot be rendered here.
 */
export function resolveBaseSeries(
  enabled: boolean,
  series: Candle[],
  cached: Candle[] | undefined
): Candle[] {
  if (!enabled) return EMPTY;
  if (series.length > 0) return series;
  return cached ?? EMPTY;
}
export type LineSeriesState = {
  candles: Candle[];
  isLoading: boolean;
  error: string | null;
  /** Requests made so far, for the loading copy. Zero once loaded or served from cache. */
  pages: number;
  refresh: () => void;
};

/**
 * The whole available price history as a single line series.
 *
 * Deliberately owns no socket. `useLiveCandles` already holds one per symbol, so the
 * ticker is passed in and only the final point is patched — otherwise opening both
 * would mean two authenticated socket connections for the same symbol.
 *
 * `enabled` gates the fetch so the walk does not run for the seven ordinary timeframes.
 */
export function useLifetimeSeries(
  symbol: string,
  enabled: boolean,
  ticker: TickerUpdate | null
): LineSeriesState {
  const [series, setSeries] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [activeKey, setActiveKey] = useState('');

  // Reset during render so switching symbol or tab never flashes the previous series,
  // matching the pattern already used in useLiveCandles and PriceChart.
  const key = `${symbol}:${enabled}:${nonce}`;
  if (key !== activeKey) {
    setActiveKey(key);
    setSeries([]);
    setError(null);
    setPages(0);
    // A cached symbol is ready immediately, so do not flash a spinner for it.
    setIsLoading(enabled && !cache.has(symbol));
  }

  useEffect(() => {
    if (!enabled || cache.has(symbol)) return;

    // The walk can span seconds and is sequential. This flag stops the results being
    // applied after a symbol switch or unmount. It does not abort the in-flight HTTP
    // requests; threading an AbortSignal through `request` would be needed for that,
    // which is not worth it for at most 12 public requests.
    let cancelled = false;

    fetchLineSeries(symbol, (loaded) => {
      if (!cancelled) setPages(loaded);
    }).then(
      (next) => {
        if (cancelled) return;
        cache.set(symbol, next);
        setSeries(next);
        setIsLoading(false);
        setPages(0);
      },
      (caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Failed to load price history');
        setIsLoading(false);
        setPages(0);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [enabled, nonce, symbol]);

  // A cache hit is served straight from the map; see resolveBaseSeries.
  const base = useMemo(
    () => resolveBaseSeries(enabled, series, cache.get(symbol)),
    [enabled, series, symbol]
  );

  // The newest bucket is still forming, so track the live price. Done as derived state
  // rather than an effect that patches the array: it keeps the effect body free of
  // setState, avoids a cascading render per tick, and skips the array copy entirely when
  // the price has not moved.
  //
  // Volume is deliberately left alone. The ticker reports a per-trade size, and adding
  // those to a weekly total would be a different quantity from the REST volume, so the
  // bar would quietly disagree with every other timeframe.
  const candles = useMemo(() => {
    if (!ticker || !Number.isFinite(ticker.price) || ticker.price <= 0) return base;
    const last = base[base.length - 1];
    if (!last || last.close === ticker.price) return base;
    return [
      ...base.slice(0, -1),
      {
        ...last,
        close: ticker.price,
        high: Math.max(last.high, ticker.price),
        low: Math.min(last.low, ticker.price),
      },
    ];
  }, [base, ticker]);

  const refresh = useCallback(() => {
    cache.delete(symbol);
    setNonce((value) => value + 1);
  }, [symbol]);

  return { candles, isLoading, error, pages, refresh };
}
