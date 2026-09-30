import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  cancelOpenOrder,
  getOpenOrdersState,
  isTerminalStatus,
  loadOpenOrders,
  subscribeOpenOrders,
  type OpenOrder,
} from '@/state/openOrders';

export type { OpenOrder, OrderStatus, OpenOrdersState } from '@/state/openOrders';

/**
 * The one writer the private WebSocket feed needs. Re-exported here so callers have a single
 * import for the list, alongside `useOpenOrders`.
 */
export { applyOrderUpdate } from '@/state/openOrders';

export type UseOpenOrders = {
  orders: OpenOrder[];
  /** Live orders only, so the tab count never includes one that has already finished. */
  openCount: number;
  isLoading: boolean;
  error: string | null;
  cancelling: ReadonlySet<string>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  refresh: () => void;
};

/**
 * Reads the shared open-orders store and makes sure it has been loaded.
 *
 * The state itself lives in `state/openOrders` rather than here, because the order form has to
 * push newly placed orders into the same list, and a hook owned by the list component cannot be
 * reached from its sibling. `applyOrderUpdate` is exported from that module for the private
 * WebSocket feed, which is the only other writer.
 */
export function useOpenOrders(): UseOpenOrders {
  const state = useSyncExternalStore(
    subscribeOpenOrders,
    getOpenOrdersState,
    getOpenOrdersState
  );

  const refresh = useCallback(() => {
    void loadOpenOrders();
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const cancelOrder = useCallback((orderId: string) => cancelOpenOrder(orderId), []);

  return {
    orders: state.orders,
    // A filled or cancelled row stays visible briefly so the outcome can be read, but it is no
    // longer an open order and must not inflate the tab's count.
    openCount: state.orders.filter((order) => !isTerminalStatus(order.status)).length,
    isLoading: state.isLoading,
    error: state.error,
    cancelling: state.cancelling,
    cancelOrder,
    refresh,
  };
}
