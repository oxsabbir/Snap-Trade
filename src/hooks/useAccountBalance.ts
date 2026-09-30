import { useEffect, useSyncExternalStore } from 'react';

import {
  getBalanceState,
  refreshBalance,
  subscribeBalance,
  type BalanceState,
} from '@/state/balance';

export type AccountBalanceState = BalanceState & { refresh: () => void };

/**
 * Reads the shared trading balance and makes sure it has been loaded.
 *
 * The state lives in `state/balance` rather than here because the order form, the route and the
 * order lifecycle all need the same numbers, and a hook gave each its own copy — so a cancel could
 * move the balance in one place while the form kept showing another.
 */
export function useAccountBalance(): AccountBalanceState {
  const state = useSyncExternalStore(subscribeBalance, getBalanceState, getBalanceState);

  useEffect(() => {
    refreshBalance();
  }, []);

  return { ...state, refresh: refreshBalance };
}
