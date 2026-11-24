import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchSymbols, getCachedSymbolRules } from '@/lib/kucoin/market';
import type { SymbolInfo } from '@/lib/kucoin/types';

export type SymbolRulesState = {
  /** Trading rules for the pair, or `null` while loading or if the pair is unknown. */
  rules: SymbolInfo | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

type Loaded = {
  rules: SymbolInfo | null;
  error: string | null;
};

const BLANK: Loaded = { rules: null, error: null };

/**
 * The per-pair rules that drive every field in the order form: increments, minimums and whether
 * trading is open. They come from the same `/symbols` payload the market list already loads, so
 * this shares that session cache rather than issuing a request per screen — the rules for a pair
 * do not move intraday.
 */
function initialLoaded(symbol: string): Loaded {
  if (!symbol) return BLANK;
  const cached = getCachedSymbolRules(symbol);
  return cached ? { rules: cached, error: null } : BLANK;
}

export function useSymbolRules(symbol: string): SymbolRulesState {
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>(() => initialLoaded(symbol));
  const [isLoading, setIsLoading] = useState(() => symbol !== '' && getCachedSymbolRules(symbol) === null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  // Reset during render using the synchronous session cache so switching pairs has exact
  // tick/increment rules on frame 1 with zero fallback flicker.
  const requestKey = symbol ? `${symbol}#${nonce}` : '';
  const [activeKey, setActiveKey] = useState(requestKey);
  if (requestKey !== activeKey) {
    setActiveKey(requestKey);
    const cached = getCachedSymbolRules(symbol);
    setLoaded(cached ? { rules: cached, error: null } : BLANK);
    setIsLoading(requestKey !== '' && cached === null);
  }

  useEffect(() => {
    if (!requestKey) return;
    if (nonce === 0 && getCachedSymbolRules(symbol) !== null) return;
    let cancelled = false;

    fetchSymbols().then(
      (symbols) => {
        if (cancelled || !mountedRef.current) return;
        const match = symbols.find((entry) => entry.symbol === symbol) ?? null;
        setLoaded({ rules: match, error: match ? null : `No trading rules for ${symbol}.` });
        setIsLoading(false);
      },
      (caught: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setLoaded({
          rules: null,
          error: caught instanceof Error ? caught.message : 'Failed to load trading rules',
        });
        setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [requestKey, symbol, nonce]);

  return { ...loaded, isLoading, refresh };
}
