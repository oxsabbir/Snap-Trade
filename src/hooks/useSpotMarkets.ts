import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { buildBaseNameIndex, fetchAllTickers, fetchCurrencies, fetchSymbols, joinMarkets } from '@/lib/kucoin/market';
import type { SpotMarket, SymbolInfo } from '@/lib/kucoin/types';

const POLL_INTERVAL_MS = 10_000;

export type SpotMarketsState = {
  markets: SpotMarket[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => void;
};

export function useSpotMarkets(): SpotMarketsState {
  const symbolsRef = useRef<SymbolInfo[] | null>(null);
  const baseNamesRef = useRef<Map<string, string> | null>(null);
  const mountedRef = useRef(true);

  const [markets, setMarkets] = useState<SpotMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const loadReference = useCallback(async () => {
    if (symbolsRef.current && baseNamesRef.current) return;
    const [symbols, currencies] = await Promise.all([fetchSymbols(), fetchCurrencies()]);
    if (!mountedRef.current) return;
    symbolsRef.current = symbols;
    baseNamesRef.current = buildBaseNameIndex(currencies);
  }, []);

  const loadTickers = useCallback(async () => {
    const symbols = symbolsRef.current;
    const baseNames = baseNamesRef.current;
    if (!symbols || !baseNames) return;
    const { ticker } = await fetchAllTickers();
    if (!mountedRef.current) return;
    setMarkets(joinMarkets(symbols, ticker, baseNames));
    setLastUpdated(Date.now());
    setError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      await loadReference();
      await loadTickers();
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Failed to load markets');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [loadReference, loadTickers]);

  useEffect(() => {
    mountedRef.current = true;
    void load();

    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, POLL_INTERVAL_MS);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void load();
    });

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [load]);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    symbolsRef.current = null;
    baseNamesRef.current = null;
    void load().finally(() => {
      if (mountedRef.current) setIsRefreshing(false);
    });
  }, [load]);

  return { markets, isLoading, isRefreshing, error, lastUpdated, refresh };
}
