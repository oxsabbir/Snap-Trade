import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  buildBaseNameIndex,
  fetchAllTickers,
  fetchCurrencies,
  fetchSymbols,
  joinMarkets,
  joinMarketsFromTickers,
} from '@/lib/kucoin/market';
import type { SpotMarket, SymbolInfo, Ticker } from '@/lib/kucoin/types';

const POLL_INTERVAL_MS = 10_000;
const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_INITIAL_RETRIES = 1;

export type SpotMarketsState = {
  markets: SpotMarket[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  refresh: () => void;
};

export function useSpotMarkets(enabled = true): SpotMarketsState {
  const symbolsRef = useRef<SymbolInfo[] | null>(null);
  const baseNamesRef = useRef<Map<string, string> | null>(null);
  const tickersRef = useRef<Ticker[] | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastLoadedAtRef = useRef(0);
  const initialRetryCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);

  const [markets, setMarkets] = useState<SpotMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  /**
   * Rebuilds the list from whatever has arrived so far. Before the reference payloads land this is
   * the ticker payload alone, which already carries everything a row draws, so the list never waits
   * on a second and third request to show anything.
   */
  const rebuild = useCallback(() => {
    const tickers = tickersRef.current;
    if (!tickers) return;
    const symbols = symbolsRef.current;
    const baseNames = baseNamesRef.current;
    setMarkets((previous) =>
      symbols && baseNames
        ? joinMarkets(symbols, tickers, baseNames, previous)
        : joinMarketsFromTickers(tickers, previous)
    );
  }, []);

  /**
   * Plain caches rather than state, so they are written whenever the request lands. Bailing out on a
   * stale mounted flag used to leave them null, which made the ticker load return early and left the
   * list empty until a later tick happened to succeed.
   */
  const loadReference = useCallback(async () => {
    if (symbolsRef.current && baseNamesRef.current) return;
    const [symbols, currencies] = await Promise.all([fetchSymbols(), fetchCurrencies()]);
    symbolsRef.current = symbols;
    baseNamesRef.current = buildBaseNameIndex(currencies);
    rebuild();
  }, [rebuild]);

  const applyTickers = useCallback(async () => {
    const { ticker } = await fetchAllTickers();
    tickersRef.current = ticker;
    if (!mountedRef.current) return;
    rebuild();
    setLastUpdated(Date.now());
    setError(null);
  }, [rebuild]);

  /**
   * The first pass pulls well over a megabyte and can still be running when the ten second tick
   * lands. Two overlapping loads issued competing requests and one lost its fetch to cancellation,
   * which surfaced as a failed load with no rows at all. A load already in flight is joined instead
   * of repeated.
   */
  const loadRef = useRef<() => Promise<void>>(null);

  useLayoutEffect(() => {
    loadRef.current = async () => {
      const pending = inFlightRef.current;
      if (pending) return pending;

      const run = (async () => {
        try {
          await applyTickers();
        } catch (caught) {
          if (mountedRef.current) {
            const errorMessage = caught instanceof Error ? caught.message : 'Failed to load markets';
            setError(errorMessage);

            if (isInitialLoadRef.current && initialRetryCountRef.current < MAX_INITIAL_RETRIES) {
              initialRetryCountRef.current += 1;
              const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, initialRetryCountRef.current - 1);
              setTimeout(() => {
                if (mountedRef.current) {
                  inFlightRef.current = null;
                  void loadRef.current?.();
                }
              }, delay);
              return;
            }

            isInitialLoadRef.current = false;
          }
        } finally {
          lastLoadedAtRef.current = Date.now();
          inFlightRef.current = null;
          if (mountedRef.current) setIsLoading(false);
        }
      })();

      inFlightRef.current = run;
      return run;
    };
  }, [applyTickers]);

  const load = useCallback(() => loadRef.current?.() ?? Promise.resolve(), []);

  // Load once on mount whether or not this screen currently has focus, so a tab the user has not
  // opened yet already holds data by the time they reach it.
  useEffect(() => {
    mountedRef.current = true;
    initialRetryCountRef.current = 0;
    isInitialLoadRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // The reference payloads only add pair names and exact price increments, so they are fetched once
  // behind the rows rather than in front of them, and a failure here degrades the list instead of
  // emptying it.
  useEffect(() => {
    void loadReference().catch(() => {});
  }, [loadReference]);

  // Poll only while the screen is on top. A tab keeps its screen mounted in the background, so
  // without this the list would keep refreshing and re-rendering behind the user's back.
  useEffect(() => {
    if (!enabled) return;

    // Coming back after a while on another screen should not show a list that has already gone
    // stale while waiting for the first tick.
    if (Date.now() - lastLoadedAtRef.current >= POLL_INTERVAL_MS) void load();

    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, POLL_INTERVAL_MS);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void load();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [enabled, load]);

  /**
   * Only the tickers are re-requested. The reference payloads are deliberately cached for the whole
   * session and clearing these refs would not change that, it would only strip the pair names off
   * the rows for a frame.
   */
  const refresh = useCallback(() => {
    setIsRefreshing(true);
    void (inFlightRef.current ?? Promise.resolve())
      .then(() => load())
      .finally(() => {
        if (mountedRef.current) setIsRefreshing(false);
      });
  }, [load]);

  return { markets, isLoading, isRefreshing, error, lastUpdated, refresh };
}