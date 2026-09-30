import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCandles, type TimeframeOrLine } from '@/lib/kucoin/candles';
import { createGenerationGuard } from '@/lib/generation';
import type { TickerUpdate } from '@/lib/kucoin/socket';
import type { Candle } from '@/lib/kucoin/types';
import { getTicker, subscribeTicker } from '@/state/ticker';

export type LiveCandlesState = {
  candles: Candle[];
  /**
   * The last candle's close as of the moment history arrived, frozen thereafter. The header
   * shows this until the socket's first tick. It is deliberately not the current close: a
   * seed that tracked the forming candle would change on every tick, which is what the chart
   * header's memoisation exists to avoid.
   */
  seedPrice: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

/**
 * The candle series for one pair, and nothing else.
 *
 * This hook used to own the `TickerSocket` and a `ticker` piece of state as well, which put
 * the live price in React state above the chart and made every tick re-render the header, the
 * order book and the order form. The socket now belongs to `@/state/ticker`; this subscribes
 * to it for the one thing it genuinely needs — the forming candle's close, high, low and
 * volume — and exposes no display state of its own.
 *
 * The subscription is deliberately not `useTicker`. Reading the snapshot here would re-render
 * this hook on every tick *as well as* re-rendering it from `setCandles`, so the chart would
 * commit twice per tick.
 */
export function useLiveCandles(
  symbol: string,
  timeframe: TimeframeOrLine,
  enabled = true
): LiveCandlesState {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [seedPrice, setSeedPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState(`${symbol}:${timeframe.key}`);
  const mountedRef = useRef(true);
  const bucketRef = useRef(0);
  const [guard] = useState(createGenerationGuard);

  // Reset during render so a timeframe switch never flashes the previous chart.
  // bucketRef is left to the fetch effect, which owns it outside render.
  //
  // Nothing else needs resetting. A timeframe is a different view of the *same* pair, so the
  // price stays valid and the header must not blank out while the chart refetches; the store
  // is keyed on the pair alone and outlives this hook's series. A new symbol is different, but
  // it is handled there too — a subscriber asking for the incoming pair gets that pair's
  // entry, which starts empty, rather than the outgoing pair's last price.
  const key = `${symbol}:${timeframe.key}`;
  if (key !== activeKey) {
    setActiveKey(key);
    setCandles([]);
    setSeedPrice(null);
    setError(null);
    setIsLoading(enabled);
  }

  // Only the ordinary timeframes have a bucket width. Under `enabled: false` — the
  // lifetime view — nothing below reads it, and handleTick returns before the rollover.
  const periodMs = 'seconds' in timeframe ? timeframe.seconds * 1000 : 0;

  const fetchHistory = useCallback(() => {
    if (!enabled) return;
    const token = guard.snapshot();
    fetchCandles(symbol, timeframe.key).then(
      (next) => {
        if (!mountedRef.current || !guard.isCurrent(token)) return;
        setCandles(next);
        setError(null);
        setIsLoading(false);
        const last = next[next.length - 1];
        bucketRef.current = last ? Math.floor(last.time / periodMs) : 0;
        // Seeded once per series. A bucket rollover refetches through here too, and the
        // guard leaves the existing seed alone so the header does not churn once a minute.
        if (last) setSeedPrice((current) => current ?? last.close);
      },
      (caught: unknown) => {
        if (!mountedRef.current || !guard.isCurrent(token)) return;
        setError(caught instanceof Error ? caught.message : 'Failed to load candles');
        setIsLoading(false);
      }
    );
  }, [enabled, guard, periodMs, symbol, timeframe.key]);

  // Deliberately no `update.symbol` check here. `tickRef` is refreshed in an effect, so just
  // after a symbol switch it still holds the previous symbol's closure and a stale tick would
  // sail through such a check. The subscription effect below owns the symbol invariant
  // instead, by tearing the old listener down in the same commit as the new one.
  const handleTick = useCallback(
    (update: TickerUpdate) => {
      if (!mountedRef.current) return;
      // The lifetime view owns its own series, so the price is only needed for the header.
      // Stopping here also keeps the zero periodMs above away from the bucket math below.
      if (!enabled) return;

      const bucket = Math.floor(update.time / periodMs);
      if (bucketRef.current !== 0 && bucket > bucketRef.current) {
        // A new bucket: refetch instead of extending the old candle. The accumulated
        // `size` is deliberately dropped here — the API snapshot for the new candle
        // already includes those trades, so adding them would double count.
        fetchHistory();
        return;
      }

      setCandles((previous) => {
        const last = previous[previous.length - 1];
        if (!last) return previous;
        const close = update.price;
        const high = Math.max(last.high, close);
        const low = Math.min(last.low, close);
        // A tick that moves nothing returns the same array, so a quiet market does not commit
        // five times a second to redraw an identical chart.
        if (last.close === close && last.high === high && last.low === low) return previous;
        return [
          ...previous.slice(0, -1),
          {
            ...last,
            close,
            high,
            low,
            // `size` is base-currency volume and KuCoin's candle volume is base too,
            // so turnover follows as size x price in quote currency.
            volume: last.volume + update.size,
            turnover: last.turnover + update.size * close,
          },
        ];
      });
    },
    [enabled, fetchHistory, periodMs]
  );

  const tickRef = useRef(handleTick);
  useEffect(() => {
    tickRef.current = handleTick;
  }, [handleTick]);

  useEffect(() => {
    mountedRef.current = true;
    // Any history request still in flight belongs to the previous series and must not be
    // allowed to write into this one.
    guard.bump();
    // The rollover refetch compares a tick's bucket against this index, and the index is
    // denominated in the current timeframe's units. Carrying the previous series' value
    // over makes the comparison meaningless — after 1D -> 1m it would never fire again.
    // Zero disables the rollover until history lands, which is the correct starting point.
    bucketRef.current = 0;
    fetchHistory();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchHistory, guard]);

  // Keyed on the pair alone, so switching timeframes refetches history without tearing the
  // subscription down and re-authenticating the connection. The store notifies without a
  // payload — that is what `useSyncExternalStore` requires — so the tick is read back here.
  useEffect(() => {
    if (!symbol) return;
    return subscribeTicker(symbol, () => {
      const update = getTicker(symbol).update;
      if (update) tickRef.current(update);
    });
  }, [symbol]);

  const refresh = useCallback(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { candles, seedPrice, isLoading, error, refresh };
}
