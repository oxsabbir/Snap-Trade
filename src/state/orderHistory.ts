/**
 * Order history, kept apart from the live open-orders store.
 *
 * The two lists answer different questions and come from different endpoints: open orders are the
 * account's active rows, refreshed as they move, while history is the finished rows — filled or
 * cancelled — which never change once they are done. Nothing here is fed by the private socket, so
 * the store only needs a load and a cache, not the merge machinery the live list depends on.
 *
 * The classic book's `GET /orders?status=done` is account-wide, but the HF book's `GET
 * /hf/orders/done` requires a `symbol`, so the HF half is scoped to the pair the view is showing.
 * That pair is part of the cache key: changing pairs clears the list and reloads it, rather than
 * showing the previous pair's history under the new heading.
 *
 * Parsing lives in `state/orderHistoryEntries`, free of React Native and the network, so it can be
 * unit-tested directly.
 */
import { describeError } from '@/lib/kucoin/errors';
import {
  fetchClassicOrderHistory,
  fetchHighFrequencyOrderHistory,
} from '@/lib/kucoin/orders';

import {
  normalizeHistoryOrder,
  sortAndDedupeHistory,
  type OrderHistoryEntry,
} from './orderHistoryEntries';

export type { HistoryStatus, OrderHistoryEntry } from './orderHistoryEntries';

export type OrderHistoryState = {
  /** The pair the current list belongs to, so a stale response cannot paint the wrong heading. */
  symbol: string | null;
  orders: OrderHistoryEntry[];
  isLoading: boolean;
  error: string | null;
};

const INITIAL_STATE: OrderHistoryState = {
  symbol: null,
  orders: [],
  isLoading: false,
  error: null,
};

let state: OrderHistoryState = INITIAL_STATE;
const listeners = new Set<() => void>();
/** Shared in-flight load, keyed implicitly by the symbol captured when it started. */
let inFlight: Promise<void> | null = null;

function emit(patch: Partial<OrderHistoryState>): void {
  state = { ...state, ...patch };
  // Copied so a listener that unsubscribes while being notified cannot skip the next one.
  for (const listener of [...listeners]) listener();
}

export function getOrderHistoryState(): OrderHistoryState {
  return state;
}

export function subscribeOrderHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Loads the history for `symbol`, replacing whatever pair was there before.
 *
 * A reload for the pair already on screen keeps its rows while the request is in flight, so a
 * manual refresh does not blank the list. Switching pairs has nothing valid to keep, so the old
 * rows are dropped immediately rather than shown under the new pair.
 */
export function loadOrderHistory(symbol: string, force = false): Promise<void> {
  if (inFlight && !force && state.symbol === symbol) return inFlight;

  const changed = state.symbol !== symbol;
  const run = (async () => {
    emit({
      symbol,
      orders: changed ? [] : state.orders,
      isLoading: changed || state.orders.length === 0,
      error: null,
    });

    try {
      const [classic, hf] = await Promise.all([
        fetchClassicOrderHistory(),
        // The HF call is best-effort: its failure must not take the classic history down with it,
        // because they are independent books and the classic one is what this app trades into.
        fetchHighFrequencyOrderHistory(symbol).catch(() => [] as unknown[]),
      ]);

      const entries = [
        ...classic
          .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
          .map((raw) => normalizeHistoryOrder(raw, 'trade')),
        ...hf
          .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
          .map((raw) => normalizeHistoryOrder(raw, 'trade_hf')),
      ].filter((entry): entry is OrderHistoryEntry => entry !== null);

      emit({ orders: sortAndDedupeHistory(entries), error: null });
    } catch (caught) {
      emit({ error: describeError(caught, 'Failed to load order history.') });
    } finally {
      inFlight = null;
      emit({ isLoading: false });
    }
  })();

  inFlight = run;
  return run;
}
