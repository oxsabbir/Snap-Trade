import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { fetchCandles, type TimeframeOrLine } from '@/lib/kucoin/candles';
import { TickerSocket, type SocketStatus, type TickerUpdate } from '@/lib/kucoin/socket';
import type { Candle } from '@/lib/kucoin/types';

export type LiveCandlesState = {
  candles: Candle[];
  ticker: TickerUpdate | null;
  status: SocketStatus;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useLiveCandles(
  symbol: string,
  timeframe: TimeframeOrLine,
  enabled = true
): LiveCandlesState {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ticker, setTicker] = useState<TickerUpdate | null>(null);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState(`${symbol}:${timeframe.key}`);
  const mountedRef = useRef(true);
  const bucketRef = useRef(0);

  // Reset during render so a timeframe switch never flashes the previous chart.
  // bucketRef is left to fetchHistory, which owns it outside render.
  const key = `${symbol}:${timeframe.key}`;
  if (key !== activeKey) {
    setActiveKey(key);
    setCandles([]);
    setTicker(null);
    setError(null);
    setIsLoading(enabled);
  }

  // Only the ordinary timeframes have a bucket width. Under `enabled: false` — the
  // lifetime view — nothing below reads it, and handleTick returns before the rollover.
  const periodMs = 'seconds' in timeframe ? timeframe.seconds * 1000 : 0;

  const fetchHistory = useCallback(() => {
    if (!enabled) return;
    fetchCandles(symbol, timeframe.key).then(
      (next) => {
        if (!mountedRef.current) return;
        setCandles(next);
        setError(null);
        setIsLoading(false);
        const last = next[next.length - 1];
        bucketRef.current = last ? Math.floor(last.time / periodMs) : 0;
        if (last) setTicker({ symbol, price: last.close, size: 0, time: last.time, bestAsk: 0, bestBid: 0 });
      },
      (caught: unknown) => {
        if (!mountedRef.current) return;
        setError(caught instanceof Error ? caught.message : 'Failed to load candles');
        setIsLoading(false);
      }
    );
  }, [enabled, periodMs, symbol, timeframe.key]);

  const handleTick = useCallback(
    (update: TickerUpdate) => {
      if (!mountedRef.current) return;
      setTicker(update);
      // The lifetime view owns its own series, so the ticker is only needed for the
      // header price and Live badge. Stopping here also keeps the zero periodMs above
      // away from the bucket math below.
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
        return [
          ...previous.slice(0, -1),
          {
            ...last,
            close: update.price,
            high: Math.max(last.high, update.price),
            low: Math.min(last.low, update.price),
            // `size` is base-currency volume and KuCoin's candle volume is base too,
            // so turnover follows as size x price in quote currency.
            volume: last.volume + update.size,
            turnover: last.turnover + update.size * update.price,
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
    fetchHistory();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchHistory]);

  // Socket lifecycle is keyed on `symbol` only, so switching timeframes refetches
  // history without tearing down and re-authenticating the connection.
  useEffect(() => {
    const socket = new TickerSocket(symbol, {
      onTick: (update) => tickRef.current(update),
      onStatus: setStatus,
    });
    socket.start();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') socket.start();
      else socket.stop();
    });

    return () => {
      socket.stop();
      subscription.remove();
    };
  }, [symbol]);

  const refresh = useCallback(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { candles, ticker, status, isLoading, error, refresh };
}
