import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCurrencies, fetchMarketStats, fetchSymbols } from '@/lib/kucoin/market';
import type { Currency, MarketStats, SymbolInfo } from '@/lib/kucoin/types';

export type CoinInfoState = {
  stats: MarketStats | null;
  symbolInfo: SymbolInfo | null;
  currency: Currency | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

const EMPTY: CoinInfoState = {
  stats: null,
  symbolInfo: null,
  currency: null,
  isLoading: false,
  error: null,
  refresh: () => {},
};

type Loaded = {
  stats: MarketStats | null;
  symbolInfo: SymbolInfo | null;
  currency: Currency | null;
  error: string | null;
};

const BLANK: Loaded = { stats: null, symbolInfo: null, currency: null, error: null };

/**
 * Loads the descriptive data behind the info sheet: per-pair 24h stats plus the
 * matching `/symbols` and `/currencies` rows. Fetching is gated on `enabled` so
 * nothing is requested until the sheet is actually opened, and the market layer
 * caches every one of these per session.
 */
export function useCoinInfo(symbol: string, enabled: boolean): CoinInfoState {
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

  // Reset during render when the target changes, so opening a different coin
  // never shows the previous coin's numbers while the new request is in flight.
  const requestKey = enabled && symbol ? `${symbol}#${nonce}` : '';
  const [activeKey, setActiveKey] = useState(requestKey);
  if (requestKey !== activeKey) {
    setActiveKey(requestKey);
    setLoaded(BLANK);
    setIsLoading(requestKey !== '');
  }

  useEffect(() => {
    if (!requestKey || !symbol) return;

    let cancelled = false;

    Promise.all([fetchMarketStats(symbol), fetchSymbols(), fetchCurrencies()]).then(
      ([nextStats, symbols, currencies]) => {
        if (cancelled || !mountedRef.current) return;
        setLoaded({
          stats: nextStats,
          symbolInfo: symbols.find((entry) => entry.symbol === symbol) ?? null,
          currency: currencies.find((entry) => entry.currency === base) ?? null,
          error: null,
        });
        setIsLoading(false);
      },
      (caught: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setLoaded({ ...BLANK, error: caught instanceof Error ? caught.message : 'Failed to load coin info' });
        setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [base, requestKey, symbol]);

  if (!enabled) return EMPTY;

  return { ...loaded, isLoading, refresh };
}
