import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCoinDescription, type CoinDescription } from '@/lib/coinInfo';

export type CoinDescriptionState = {
  description: CoinDescription | null;
  /** True once a request has settled. May still be null when no description exists for the coin. */
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

const EMPTY: CoinDescriptionState = {
  description: null,
  isLoaded: false,
  isLoading: false,
  error: null,
  refresh: () => {},
};

type Loaded = {
  description: CoinDescription | null;
  isLoaded: boolean;
  error: string | null;
};

const BLANK: Loaded = { description: null, isLoaded: false, error: null };

/**
 * Loads the project summary behind the info sheet's About section, from CoinPaprika. Gated on
 * `enabled` and keyed by the base ticker so opening a different coin never shows the previous
 * paragraph while the new lookup is in flight, and the `coinInfo` layer caches each result for the
 * session. A coin with no description settles as loaded with a null description, which the sheet
 * renders as nothing at all.
 */
export function useCoinDescription(symbol: string, enabled: boolean): CoinDescriptionState {
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

  // Reset during render when the target changes, mirroring `useCoinInfo`.
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

    fetchCoinDescription(base).then(
      (description) => {
        if (cancelled || !mountedRef.current) return;
        setLoaded({ description, isLoaded: true, error: null });
        setIsLoading(false);
      },
      (caught: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setLoaded({
          description: null,
          isLoaded: true,
          error: caught instanceof Error ? caught.message : 'Failed to load description',
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
