import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCoinMarket, type CoinMarket } from '@/lib/coinInfo';

export type CoinMarketState = {
  market: CoinMarket | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

const EMPTY: CoinMarketState = {
  market: null,
  isLoading: false,
  error: null,
  refresh: () => {},
};

type Loaded = {
  market: CoinMarket | null;
  error: string | null;
};

const BLANK: Loaded = { market: null, error: null };

/**
 * Loads market capitalisation and supply for the info sheet's Market section, from CoinPaprika.
 * Gated on `enabled` and keyed by the base ticker so opening another coin never shows the previous
 * coin's cap while the lookup is in flight, and `coinInfo` caches each result for the session. A
 * coin with no CoinPaprika match settles as a null market, which the sheet renders as nothing.
 */
export function useCoinMarket(symbol: string, enabled: boolean): CoinMarketState {
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>(BLANK);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const [base] = symbol.split('-');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  const requestKey = enabled && base ? `${base}#${nonce}` : '';
  const [activeKey, setActiveKey] = useState(requestKey);
  if (requestKey !== activeKey) {
    setActiveKey(requestKey);
    setLoaded(BLANK);
    setIsLoading(requestKey !== '');
  }

  useEffect(() => {
    if (!requestKey || !base) return;

    let cancelled = false;

    fetchCoinMarket(base).then(
      (market) => {
        if (cancelled || !mountedRef.current) return;
        setLoaded({ market, error: null });
        setIsLoading(false);
      },
      (caught: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setLoaded({
          market: null,
          error: caught instanceof Error ? caught.message : 'Failed to load market data',
        });
        setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [base, requestKey]);

  if (!enabled) return EMPTY;

  return { ...loaded, isLoading, refresh };
}
