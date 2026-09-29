import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { buildPortfolio, fetchAccounts, type Portfolio } from '@/lib/kucoin/account';
import { clearCredentials, loadCredentials, saveCredentials } from '@/lib/kucoin/credentials';
import { fetchAllTickers } from '@/lib/kucoin/market';
import { clearAccountInfoCache, fetchAccountInfo } from '@/lib/kucoin/profile';
import { describeError } from '@/lib/kucoin/errors';
import type { AccountInfo, KuCoinCredentials, PortfolioAsset } from '@/lib/kucoin/types';

const POLL_INTERVAL_MS = 30_000;

export type AccountStatus = 'loading' | 'disconnected' | 'ready' | 'error';

export type AccountState = {
  status: AccountStatus;
  portfolio: Portfolio;
  assets: PortfolioAsset[];
  total: number;
  accountInfo: AccountInfo | null;
  error: string | null;
  lastUpdated: number | null;
  connect: (credentials: KuCoinCredentials) => Promise<void>;
  disconnect: () => Promise<void>;
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

  const [status, setStatus] = useState<AccountStatus>('loading');
  const [portfolio, setPortfolio] = useState<Portfolio>(EMPTY_PORTFOLIO);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchPortfolio = useCallback(async () => {
    const [accounts, { ticker }] = await Promise.all([fetchAccounts(), fetchAllTickers()]);
    const next = buildPortfolio(accounts, ticker);
    if (!mountedRef.current) return;
    setPortfolio(next);
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
        if (mountedRef.current) setAccountInfo(info);
      },
      () => undefined
    );
  }, []);

  const load = useCallback(async () => {
    const credentials = await loadCredentials();
    if (!mountedRef.current) return;
    if (!credentials) {
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
  }, [fetchPortfolio, loadAccountInfo]);

  useEffect(() => {
    mountedRef.current = true;
    // Every setState in load() is behind `await loadCredentials()`, so this is an async
    // bootstrap, not a synchronous cascade. The rule cannot see through the await.
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

  /**
   * Verifies before committing: a key that fails the first call is cleared and the error
   * is rethrown so the connect form can show it inline rather than landing on the error card.
   */
  const connect = useCallback(
    async (credentials: KuCoinCredentials) => {
      await saveCredentials(credentials);
      clearAccountInfoCache();
      try {
        await fetchPortfolio();
        loadAccountInfo();
      } catch (caught) {
        await clearCredentials();
        if (mountedRef.current) {
          setPortfolio(EMPTY_PORTFOLIO);
          setStatus('disconnected');
        }
        throw new Error(describeError(caught, 'Failed to load account'));
      }
    },
    [fetchPortfolio, loadAccountInfo]
  );

  const disconnect = useCallback(async () => {
    await clearCredentials();
    clearAccountInfoCache();
    if (!mountedRef.current) return;
    setPortfolio(EMPTY_PORTFOLIO);
    setAccountInfo(null);
    setError(null);
    setLastUpdated(null);
    setStatus('disconnected');
  }, []);

  const refresh = useCallback(() => {
    setStatus((current) => (current === 'disconnected' ? current : 'loading'));
    void load();
  }, [load]);

  return {
    status,
    portfolio,
    assets: portfolio.assets,
    total: portfolio.total,
    accountInfo,
    error,
    lastUpdated,
    connect,
    disconnect,
    refresh,
  };
}
