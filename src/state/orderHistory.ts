/**
 * Order history, kept apart from the live open-orders store.
 *
 * The two lists answer different questions and come from different endpoints: open orders are the
 * account's active rows, refreshed as they move, while history is the finished rows — filled or
 * cancelled — which never change once they are done. Nothing here is fed by the private socket, so
 * the store only needs a load, a page cursor and a cache, not the merge machinery the live list
 * depends on.
 *
 * The classic book's `GET /orders?status=done` is account-wide and pages by number, while the HF
 * book's `GET /hf/orders/done` requires a `symbol` and pages by cursor. Both are asked a small first
 * page; older pages are appended one at a time as the History view scrolls. That pair is part of the
 * cache key: changing pairs clears the list and reloads it, rather than showing the previous pair's
 * history under the new heading.
 *
 * Parsing lives in `state/orderHistoryEntries`, free of React Native and the network, so it can be
 * unit-tested directly.
 */
import { describeError } from '@/lib/kucoin/errors';
import {
  fetchClassicOrderHistory,
  fetchHighFrequencyOrderHistory,
  type ClassicOrderHistoryPage,
  type HighFrequencyOrderHistoryPage,
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
  /** True while an older page is being appended, so the rows already shown stay put. */
  isLoadingMore: boolean;
  /** True when either book still has an older page to fetch. */
  hasMore: boolean;
  error: string | null;
};

const INITIAL_STATE: OrderHistoryState = {
  symbol: null,
  orders: [],
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  error: null,
};

let state: OrderHistoryState = INITIAL_STATE;
const listeners = new Set<() => void>();
/** Shared in-flight first-page load, keyed implicitly by the symbol captured when it started. */
let inFlight: Promise<void> | null = null;
/** Shared in-flight append, so a burst of scroll events cannot stack requests. */
let inFlightMore: Promise<void> | null = null;

/** Cursor into the classic book's page-based listing: the page currently shown. */
let classicPage = 1;
/** Cursor into the HF book's `lastId`-based listing; `null` once that book is exhausted. */
let hfLastId: string | null = null;
/** Which books still have older pages, so an append only asks the ones that do. */
let classicHasMore = false;
let hfHasMore = false;

/**
 * Number of mounted History views. The route's scroll handler fires on every tab, and only the
 * History tab should spend a request, so `loadMoreOrderHistory` is a no-op while this is zero.
 */
let viewers = 0;

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
 * Registers a mounted History view and returns its unregister. Pagination only makes sense while a
 * History view is on screen, so the store uses this to ignore load-more signals from other tabs.
 */
export function retainOrderHistory(): () => void {
  viewers += 1;
  return () => {
    viewers -= 1;
  };
}

/** Normalizes one page of raw rows from both books into the entry shape the list uses. */
function toEntries(classic: unknown[], hf: unknown[]): OrderHistoryEntry[] {
  return [
    ...classic
      .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
      .map((raw) => normalizeHistoryOrder(raw, 'trade')),
    ...hf
      .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
      .map((raw) => normalizeHistoryOrder(raw, 'trade_hf')),
  ].filter((entry): entry is OrderHistoryEntry => entry !== null);
}

/**
 * Loads the first page of history for `symbol`, replacing whatever pair was there before.
 *
 * A reload for the pair already on screen keeps its rows while the request is in flight, so a
 * manual refresh does not blank the list. Switching pairs has nothing valid to keep, so the old
 * rows are dropped immediately rather than shown under the new pair, and the page cursors reset.
 */
export function loadOrderHistory(symbol: string, force = false): Promise<void> {
  if (inFlight && !force && state.symbol === symbol) return inFlight;

  const changed = state.symbol !== symbol;
  const run = (async () => {
    emit({
      symbol,
      orders: changed ? [] : state.orders,
      isLoading: changed || state.orders.length === 0,
      isLoadingMore: false,
      hasMore: false,
      error: null,
    });

    try {
      const [classic, hf] = await Promise.all([
        fetchClassicOrderHistory(1),
        // The HF call is best-effort: its failure must not take the classic history down with it,
        // because they are independent books and the classic one is what this app trades into.
        fetchHighFrequencyOrderHistory(symbol).catch(
          (): HighFrequencyOrderHistoryPage => ({ items: [], hasMore: false, lastId: null })
        ),
      ]);

      // The pair can change while the request is in flight; a late response for the old pair must
      // not paint over the new one or move its cursors.
      if (state.symbol !== symbol) return;

      classicPage = 1;
      classicHasMore = classic.hasMore;
      hfLastId = hf.lastId;
      hfHasMore = hf.hasMore;

      emit({
        orders: sortAndDedupeHistory(toEntries(classic.items, hf.items)),
        hasMore: classicHasMore || hfHasMore,
        error: null,
      });
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

/**
 * Appends the next page of history for `symbol`. Called repeatedly as the History view nears the
 * bottom of the screen, so it is a no-op until there is something to fetch and nobody is fetching.
 *
 * Each book is paged independently — the classic one by page number, HF by `lastId` — and only the
 * books that still have older rows are asked, so an exhausted book costs nothing.
 */
export function loadMoreOrderHistory(symbol: string): Promise<void> {
  if (inFlightMore) return inFlightMore;
  if (viewers === 0) return Promise.resolve();
  if (state.symbol !== symbol) return Promise.resolve();
  if (state.isLoading || state.isLoadingMore || !state.hasMore) return Promise.resolve();

  const run = (async () => {
    emit({ isLoadingMore: true, error: null });
    try {
      const wantsClassic = classicHasMore;
      const wantsHf = hfHasMore;
      const [classic, hf] = await Promise.all([
        wantsClassic
          ? fetchClassicOrderHistory(classicPage + 1)
          : Promise.resolve<ClassicOrderHistoryPage>({
              items: [],
              hasMore: false,
              page: classicPage,
            }),
        wantsHf
          ? fetchHighFrequencyOrderHistory(symbol, hfLastId)
          : Promise.resolve<HighFrequencyOrderHistoryPage>({
              items: [],
              hasMore: false,
              lastId: hfLastId,
            }),
      ]);

      if (state.symbol !== symbol) return;

      if (wantsClassic) {
        classicPage = classic.page;
        classicHasMore = classic.hasMore;
      }
      if (wantsHf) {
        hfLastId = hf.lastId;
        hfHasMore = hf.hasMore;
      }

      emit({
        orders: sortAndDedupeHistory([...state.orders, ...toEntries(classic.items, hf.items)]),
        hasMore: classicHasMore || hfHasMore,
        error: null,
      });
    } catch (caught) {
      emit({ error: describeError(caught, 'Failed to load more order history.') });
    } finally {
      inFlightMore = null;
      emit({ isLoadingMore: false });
    }
  })();

  inFlightMore = run;
  return run;
}
