import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { buildPortfolio, fetchAccounts, totalValue } from '@/lib/kucoin/account';
import { clearCredentials, loadCredentials, saveCredentials } from '@/lib/kucoin/credentials';
import { fetchAllTickers } from '@/lib/kucoin/market';
import { KuCoinApiError } from '@/lib/kucoin/client';
import type { KuCoinCredentials, PortfolioAsset } from '@/lib/kucoin/types';

const POLL_INTERVAL_MS = 30_000;

export type AccountStatus = 'loading' | 'disconnected' | 'ready' | 'error';

export type AccountState = {
  status: AccountStatus;
  assets: PortfolioAsset[];
  total: number;
  error: string | null;
  lastUpdated: number | null;
  connect: (credentials: KuCoinCredentials) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => void;
};

function describe(error: unknown): string {
  if (error instanceof KuCoinApiError) {
    if (error.code === '400003') return 'Invalid API key, secret or passphrase.';
    if (error.code === '400004') return 'Passphrase does not match this API key.';
    if (error.status === 401 || error.code === '401000') return 'KuCoin rejected these credentials.';
    if (error.code === 'NETWORK_ERROR') return 'Network unavailable. Check your connection.';
    if (error.code === 'NO_CREDENTIALS') return 'No credentials found on this device.';
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : 'Failed to load account';
}

export function useAccount(): AccountState {
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<AccountStatus>('loading');
  const [assets, setAssets] = useState<PortfolioAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchPortfolio = useCallback(async () => {
    const [accounts, { ticker }] = await Promise.all([fetchAccounts(), fetchAllTickers()]);
    const portfolio = buildPortfolio(accounts, ticker);
    if (!mountedRef.current) return;
    setAssets(portfolio);
    setTotal(totalValue(portfolio));
    setLastUpdated(Date.now());
    setError(null);
    setStatus('ready');
  }, []);

  const load = useCallback(async () => {
    const credentials = await loadCredentials();
    if (!mountedRef.current) return;
    if (!credentials) {
      setAssets([]);
      setTotal(0);
      setStatus('disconnected');
      return;
    }
    try {
      await fetchPortfolio();
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(describe(caught));
      setStatus('error');
    }
  }, [fetchPortfolio]);

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
      try {
        await fetchPortfolio();
      } catch (caught) {
        await clearCredentials();
        if (mountedRef.current) {
          setAssets([]);
          setTotal(0);
          setStatus('disconnected');
        }
        throw new Error(describe(caught));
      }
    },
    [fetchPortfolio]
  );

  const disconnect = useCallback(async () => {
    await clearCredentials();
    if (!mountedRef.current) return;
    setAssets([]);
    setTotal(0);
    setError(null);
    setLastUpdated(null);
    setStatus('disconnected');
  }, []);

  const refresh = useCallback(() => {
    setStatus((current) => (current === 'disconnected' ? current : 'loading'));
    void load();
  }, [load]);

  return { status, assets, total, error, lastUpdated, connect, disconnect, refresh };
}
