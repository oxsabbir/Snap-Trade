import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  getOrderHistoryState,
  loadMoreOrderHistory,
  loadOrderHistory,
  retainOrderHistory,
  subscribeOrderHistory,
  type OrderHistoryEntry,
} from '@/state/orderHistory';

export type { OrderHistoryEntry, HistoryStatus } from '@/state/orderHistory';

export type UseOrderHistory = {
  orders: OrderHistoryEntry[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
};

/**
 * Reads the shared order-history store for one pair and makes sure it has been loaded.
 *
 * The store is module-level rather than component state so the list survives the tab unmounting and
 * remounting as the user switches tabs — returning to History shows the last result immediately
 * instead of a spinner. The symbol is the cache key, so a different pair reloads and a same-pair
 * remount does not.
 *
 * While mounted it also marks a History view as retained, which is what lets the route's scroll
 * handler page in older rows without every other tab spending the request.
 */
export function useOrderHistory(symbol: string): UseOrderHistory {
  const state = useSyncExternalStore(
    subscribeOrderHistory,
    getOrderHistoryState,
    getOrderHistoryState
  );

  useEffect(() => {
    void loadOrderHistory(symbol);
  }, [symbol]);

  useEffect(() => retainOrderHistory(), []);

  const refresh = useCallback(() => {
    void loadOrderHistory(symbol, true);
  }, [symbol]);

  const loadMore = useCallback(() => {
    void loadMoreOrderHistory(symbol);
  }, [symbol]);

  // Rows for a pair other than the one asked for belong to a load that has not finished yet, so
  // they are hidden rather than mislabelled; the loading flag tracks that first paint.
  const isCurrentPair = state.symbol === symbol;

  return {
    orders: isCurrentPair ? state.orders : [],
    isLoading: isCurrentPair ? state.isLoading : true,
    isLoadingMore: isCurrentPair ? state.isLoadingMore : false,
    hasMore: isCurrentPair ? state.hasMore : false,
    error: isCurrentPair ? state.error : null,
    loadMore,
    refresh,
  };
}
