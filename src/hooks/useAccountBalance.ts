import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { fetchAccounts } from '@/lib/kucoin/account';
import { describeError } from '@/lib/kucoin/errors';
import { addDecimal } from '@/utils/decimal';

export type AccountBalanceState = {
  /** Free balance per currency in the `trade` wallet, as decimal strings. Absent means zero. */
  available: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

const EMPTY: Record<string, string> = {};

/**
 * The spendable balance behind the order form's "Available" row. It reads only the `trade`
 * wallet, because that is the one `POST /api/v1/orders` debits; a balance sitting in `main`
 * cannot fund the order and must not be shown as if it could. `test`/`hf` keys live in their own
 * wallets for the same reason.
 *
 * It refetches when the app returns to the foreground and on demand after a fill, so the number
 * on screen tracks the account rather than a value captured at mount.
 */
export function useAccountBalance(): AccountBalanceState {
  const [available, setAvailable] = useState<Record<string, string>>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const accounts = await fetchAccounts('trade');
      if (!mountedRef.current) return;
      const next: Record<string, string> = {};
      for (const account of accounts) {
        if (account.type !== 'trade') continue;
        next[account.currency] = sumAvailable(next[account.currency], account.available);
      }
      setAvailable(next);
      setError(null);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(describeError(caught, 'Failed to load balance'));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // The setState calls are all behind the awaited fetch, so this is an async bootstrap rather
    // than a synchronous cascade. The rule cannot see through the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void load();
    });

    return () => {
      mountedRef.current = false;
      subscription.remove();
    };
  }, [load]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  return { available, isLoading, error, refresh };
}

function sumAvailable(current: string | undefined, next: string): string {
  if (!current) return next;
  return addDecimal(current, next) ?? next;
}
