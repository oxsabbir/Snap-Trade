import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchLineSeries } from '@/lib/kucoin/candles';
import type { Candle } from '@/lib/kucoin/types';
import { getTicker, subscribeTicker } from '@/state/ticker';

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
  /**
   * The last candle's close as of the moment history arrived, frozen thereafter. The chart
   * header shows this until the socket's first tick. The Line tab skips the candle fetch
   * entirely, so without this the header would have nothing at all to show on mount.
   */
  seedPrice: number | null;
  isLoading: boolean;
  error: string | null;
  /** Requests made so far, for the loading copy. Zero once loaded or served from cache. */
  pages: number;
  refresh: () => void;
};

/**
 * The whole available price history as a single line series.
 *
 * Opens no connection of its own: `@/state/ticker` already holds one per symbol and hands it
 * out to subscribers, so asking it for the last price here is a subscription on an existing
 * socket rather than a second authenticated connection. Only the newest bucket is tracked from
 * it — the rest of the series is history.
 *
 * `enabled` gates the fetch so the walk does not run for the seven ordinary timeframes.
 */
export function useLifetimeSeries(symbol: string, enabled: boolean): LineSeriesState {
  const [series, setSeries] = useState<Candle[]>([]);
  const [seedPrice, setSeedPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [activeKey, setActiveKey] = useState('');

  // Reset during render so switching symbol or tab never flashes the previous series,
  // matching the pattern already used in useLiveCandles and PriceChart.
  const key = `${symbol}:${enabled}:${nonce}`;
  if (key !== activeKey) {
    const cached = cache.get(symbol);
    setActiveKey(key);
    setSeries([]);
    // A cached symbol has no fetch to seed from — its effect returns early — so it is seeded
    // here from the cached walk instead, which keeps the header populated on a repeat visit.
    const cachedLast = cached?.[cached.length - 1];
    setSeedPrice(cached ? (cachedLast?.close ?? null) : null);
    setError(null);
    setPages(0);
    setLivePrice(null);
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
        // The header needs a price before the socket's first tick, and this tab never loads
        // candle history. Frozen once seeded; see LiveCandlesState.seedPrice.
        const last = next[next.length - 1];
        if (last) setSeedPrice(last.close);
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

  // The newest bucket is still forming, so track the live price. Held as its own piece of state
  // and folded in below rather than patching the array in the subscription, so the effect body
  // stays free of array work and a price that has not moved costs nothing.
  useEffect(() => {
    if (!symbol) return;
    return subscribeTicker(symbol, () => {
      const update = getTicker(symbol).update;
      if (!update || !Number.isFinite(update.price) || update.price <= 0) return;
      setLivePrice(update.price);
    });
  }, [symbol]);

  // A cache hit is served straight from the map; see resolveBaseSeries.
  const base = useMemo(
    () => resolveBaseSeries(enabled, series, cache.get(symbol)),
    [enabled, series, symbol]
  );

  // Volume is deliberately left alone. The ticker reports a per-trade size, and adding
  // those to a weekly total would be a different quantity from the REST volume, so the
  // bar would quietly disagree with every other timeframe.
  const candles = useMemo(() => {
    if (livePrice === null) return base;
    const last = base[base.length - 1];
    if (!last || last.close === livePrice) return base;
    return [
      ...base.slice(0, -1),
      {
        ...last,
        close: livePrice,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
      },
    ];
  }, [base, livePrice]);

  const refresh = useCallback(() => {
    cache.delete(symbol);
    setNonce((value) => value + 1);
  }, [symbol]);

  return { candles, seedPrice, isLoading, error, pages, refresh };
}
