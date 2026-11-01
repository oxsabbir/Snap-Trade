import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { buildPortfolio, fetchAccounts, type Portfolio } from '@/lib/kucoin/account';
import { fetchAllTickers } from '@/lib/kucoin/market';
import { fetchAccountInfo } from '@/lib/kucoin/profile';
import { describeError } from '@/lib/kucoin/errors';
import type { AccountInfo, PortfolioAsset, Ticker } from '@/lib/kucoin/types';
import { useApiCredentials } from '@/state/apiCredentials';

const POLL_INTERVAL_MS = 30_000;

/**
 * Last good portfolio + tickers, kept at module level so a remount (navigating back to the
 * tab, or switching to the markets tab and home) paints the previous data instantly and
 * refreshes silently, instead of resetting to an empty portfolio and a spinner with a
 * multi-second redownload.
 */
let cachedPortfolio: Portfolio | null = null;
let cachedTickers: Ticker[] = [];
let cachedAccountInfo: AccountInfo | null = null;

export type AccountStatus = 'loading' | 'disconnected' | 'ready' | 'error';

export type AccountState = {
  status: AccountStatus;
  portfolio: Portfolio;
  assets: PortfolioAsset[];
  total: number;
  accountInfo: AccountInfo | null;
  /** Raw tickers behind `portfolio`'s prices, shared with PnL so it needs no second fetch. */
  tickers: Ticker[];
  error: string | null;
  lastUpdated: number | null;
  refresh: () => void;
};

const EMPTY_PORTFOLIO: Portfolio = {
  assets: [],
  holdings: [],
  funding: { kind: 'funding', label: 'Funding', hint: 'Your main wallet', assets: [], total: 0, onHold: 0 },
  trading: { kind: 'trading', label: 'Trading', hint: 'Funds available to trade', assets: [], total: 0, onHold: 0 },
  total: 0,
  onHold: 0,
  unpricedCount: 0,
};

export function useAccount(): AccountState {
  const mountedRef = useRef(true);
  const { isConnected } = useApiCredentials();

  const [status, setStatus] = useState<AccountStatus>(cachedPortfolio ? 'ready' : 'loading');
  const [portfolio, setPortfolio] = useState<Portfolio>(cachedPortfolio ?? EMPTY_PORTFOLIO);
  const [tickers, setTickers] = useState<Ticker[]>(cachedTickers);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(cachedAccountInfo);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchPortfolio = useCallback(async () => {
    const [accounts, { ticker }] = await Promise.all([fetchAccounts(), fetchAllTickers()]);
    const next = buildPortfolio(accounts, ticker);
    if (!mountedRef.current) return;
    setPortfolio(next);
    setTickers(ticker);
    cachedPortfolio = next;
    cachedTickers = ticker;
    setLastUpdated(Date.now());
    setError(null);
    setStatus('ready');
  }, []);

  /**
   * Best effort and deliberately not awaited alongside the balances: this is
   * Management-pool weight 20, it is cached, and a failure here must not block
   * or clear a working connection.
   */
  const loadAccountInfo = useCallback(() => {
    void fetchAccountInfo().then(
      (info) => {
        if (!mountedRef.current) return;
        cachedAccountInfo = info;
        setAccountInfo(info);
      },
      () => undefined
    );
  }, []);

  const load = useCallback(async () => {
    if (!isConnected) {
      setPortfolio(EMPTY_PORTFOLIO);
      setStatus('disconnected');
      return;
    }
    try {
      await fetchPortfolio();
      loadAccountInfo();
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(describeError(caught, 'Failed to load account'));
      setStatus('error');
    }
  }, [fetchPortfolio, isConnected, loadAccountInfo]);

  useEffect(() => {
    mountedRef.current = true;
    // The root route guard loads credentials before mounting any account screen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // With a warm cache the data on screen is seconds old already — showing the loading
    // state would flash a spinner over live numbers for the whole fetch.
    if (!cachedPortfolio) setStatus('loading');
    void load();
  }, [load]);

  return {
    status,
    portfolio,
    assets: portfolio.assets,
    total: portfolio.total,
    accountInfo,
    tickers,
    error,
    lastUpdated,
    refresh,
  };
}
