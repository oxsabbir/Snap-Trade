/**
 * Open orders, shared across the trade screen.
 *
 * The order form and the open-orders list are siblings under one route. An order placed in the
 * form has to show up in the list on the same tap, and a list that only learns about orders from
 * its own REST poll puts a network round trip between pressing Buy and seeing anything — which
 * reads as the button not working.
 *
 * So the state lives here instead of inside the list component. `TradePanel` pushes a freshly
 * placed order straight in, `OrderManagement` reads the same store, and `state/privateFeed` feeds
 * `applyOrderUpdate` from `/spotMarket/tradeOrdersV2` — which is what makes a cancellation or fill
 * performed on the desktop appear here too. Same store-and-subscribe shape `state/ticker.ts` uses
 * for prices, so the list survives the list component unmounting and neither sibling has to
 * re-render the other.
 *
 * The frame parsing and merge rules live in `state/orderUpdates`, kept free of React Native and the
 * network so they can be unit-tested directly.
 */
import { describeError, isOrderGoneError } from '@/lib/kucoin/errors';
import {
  cancelOrder,
  fetchSpotOrderById,
  fetchClassicOpenOrders,
  fetchHighFrequencyOpenOrders,
  fetchHighFrequencyOrderSymbols,
  type SpotOrderWallet,
} from '@/lib/kucoin/orders';
import type { OrderSide } from '@/lib/kucoin/types';
import { refreshBalance, reconcileBalanceAfterChange } from '@/state/balance';
import { scheduleCostBasisRefresh } from '@/state/costBasis';

import {
  isTerminalStatus,
  mergeOrderUpdate,
  mergeRestSnapshot,
  normalizeOrder,
  type OpenOrder,
} from './orderUpdates';

export { isTerminalStatus, normalizeOrder } from './orderUpdates';
export type { OpenOrder, OrderStatus } from './orderUpdates';

export type OpenOrdersState = {
  orders: OpenOrder[];
  isLoading: boolean;
  error: string | null;
  /** Order ids with a cancel in flight, so each row can show its own spinner. */
  cancelling: ReadonlySet<string>;
};

const INITIAL_STATE: OpenOrdersState = {
  orders: [],
  isLoading: false,
  error: null,
  cancelling: new Set(),
};

/** How long a locally inserted order is kept if the exchange has not listed it yet. */
const UNCONFIRMED_TTL_MS = 20_000;
const PLACED_ORDER_RECHECK_DELAYS_MS = [450, 1_200, 2_500] as const;

let state: OpenOrdersState = INITIAL_STATE;
const listeners = new Set<() => void>();

/**
 * Orders inserted locally before the exchange confirmed them. A refresh merges these back in so
 * a row does not blink out of existence in the gap between placement and the first response that
 * includes it.
 */
const unconfirmed = new Map<string, OpenOrder>();

/**
 * IDs retired by a terminal WebSocket event. A REST active-order request can have started before
 * that event and return its older snapshot afterward; these IDs stop that response resurrecting a
 * filled/cancelled row. They are discarded once REST confirms the order is no longer active.
 */
const terminalOrderIds = new Set<string>();

let inFlight: Promise<void> | null = null;

function emit(patch: Partial<OpenOrdersState>): void {
  state = { ...state, ...patch };
  // Copied so a listener that unsubscribes while being notified cannot skip the next one.
  for (const listener of [...listeners]) listener();
}

export function getOpenOrdersState(): OpenOrdersState {
  return state;
}

export function subscribeOpenOrders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function reconcileUnconfirmed(rest: OpenOrder[]): OpenOrder[] {
  const listed = new Set(rest.map((order) => order.orderId));
  const now = Date.now();
  const carried: OpenOrder[] = [];

  for (const [orderId, order] of [...unconfirmed]) {
    if (listed.has(orderId)) {
      unconfirmed.delete(orderId);
      continue;
    }
    // The exchange never listed it, so either it filled before it was ever open or it never
    // existed. Either way it is not ours to show.
    if (now - order.createdAt > UNCONFIRMED_TTL_MS || isTerminalStatus(order.status)) {
      unconfirmed.delete(orderId);
      continue;
    }
    carried.push(order);
  }

  carried.sort((a, b) => b.createdAt - a.createdAt);
  return carried;
}

/** Pair count past which the HF book is not walked. Bounds a refresh that would otherwise fan out
 *  into dozens of rate-limited requests on an account with many open orders. */
const MAX_HF_SYMBOLS = 20;

/**
 * Active HF orders across the account.
 *
 * Best-effort by design: a failure here must not take the classic list down with it, since the two
 * are independent books and the classic one is what this app places into by default.
 */
async function loadHighFrequencyOrders(): Promise<OpenOrder[]> {
  try {
    const symbols = await fetchHighFrequencyOrderSymbols();
    if (symbols.length === 0) return [];

    const lists = await Promise.all(
      symbols
        .slice(0, MAX_HF_SYMBOLS)
        .map((pair) => fetchHighFrequencyOpenOrders(pair).catch(() => [] as unknown[]))
    );

    return lists
      .flat()
      .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
      .map((raw) => normalizeOrder(raw, 'trade_hf'))
      .filter((order): order is OpenOrder => order !== null);
  } catch {
    return [];
  }
}

/**
 * Replaces the list from the exchange's active orders, keeping any locally inserted order the
 * response has not caught up with yet. Concurrent calls share one request.
 *
 * Both spot books are read, because an order in either one is spendable and the user would
 * otherwise be unable to see or cancel it. Every row carries the `wallet` it came from so the
 * cancel is sent back to the endpoint that owns it.
 */
export function loadOpenOrders(force = false): Promise<void> {
  if (inFlight && !force) return inFlight;

  const run = (async () => {
    // A refresh that runs over rows the user can already see must not raise the loading flag,
    // or the list is replaced by a spinner every time a cancel reconciles.
    emit({ isLoading: state.orders.length === 0, error: null });
    try {
      // The classic book is the one this app places into, so its failure is the one worth showing.
      const [classic, hf] = await Promise.all([fetchClassicOpenOrders(), loadHighFrequencyOrders()]);

      const rest = [...classic, ...hf]
        .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
        .map((raw, index) =>
          // Rows past the classic list are HF, and only the HF shape needs the wallet stamped on
          // it — the classic response never carries one.
          normalizeOrder(raw, index >= classic.length ? 'trade_hf' : 'trade')
        )
        .filter((order): order is OpenOrder => order !== null)
        // Active-order endpoints can briefly return an order whose final fill has already
        // completed. Never put terminal exchange data back into the open-orders store.
        .filter((order) => !isTerminalStatus(order.status));

      const restIds = new Set(rest.map((order) => order.orderId));
      for (const orderId of terminalOrderIds) {
        if (!restIds.has(orderId)) terminalOrderIds.delete(orderId);
      }
      const activeRest = rest.filter((order) => !terminalOrderIds.has(order.orderId));

      // A snapshot can predate a fill that arrived over the socket while the request was in
      // flight, so an order already on screen keeps whichever value is further along.
      const known = new Map(state.orders.map((order) => [order.orderId, order]));
      const merged = activeRest.map((order) => {
        const previous = known.get(order.orderId);
        return previous ? mergeRestSnapshot(previous, order) : order;
      });

      emit({ orders: [...merged, ...reconcileUnconfirmed(merged)], error: null });
    } catch (caught) {
      emit({ error: describeError(caught, 'Failed to load open orders.') });
    } finally {
      inFlight = null;
      emit({ isLoading: false });
    }
  })();

  inFlight = run;
  return run;
}

/**
 * Shows a just-placed order immediately, without waiting for the exchange or a refresh.
 *
 * Call this the moment placement succeeds so the row is already there when the user looks down at
 * the list. Do not call it for a `/orders/test` dry run: that returns an id the exchange never
 * created, so the row would sit there uncancellable.
 */
export function trackPlacedOrder(
  placed: { orderId: string; clientOid?: string },
  details: {
    symbol: string;
    side: OrderSide;
    price: string;
    size: string;
    wallet?: SpotOrderWallet;
    type?: 'limit' | 'market';
  }
): void {
  const order: OpenOrder = {
    orderId: placed.orderId,
    clientOid: placed.clientOid,
    symbol: details.symbol,
    side: details.side,
    type: details.type ?? 'limit',
    price: details.price,
    size: details.size,
    filledSize: '0',
    status: 'open',
    wallet: details.wallet ?? 'trade',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  terminalOrderIds.delete(order.orderId);
  unconfirmed.set(order.orderId, order);
  emit({
    orders: [order, ...state.orders.filter((o) => o.orderId !== order.orderId)],
    error: null,
  });

  // Placing freezes the funds straight away, so the spendable balance has already moved.
  refreshBalance();
  schedulePlacedOrderReconciliation(order.orderId);
}

/**
 * The active-order endpoint can omit an order that filled immediately, while the private socket
 * may not deliver its terminal frame before the user opens this panel. Check the order itself a
 * few times after placement; `active: false` / `isActive: false` is authoritative and removes the
 * optimistic row, while an active detail refreshes the partial-fill progress.
 */
function schedulePlacedOrderReconciliation(orderId: string): void {
  let attempt = 0;

  const check = async () => {
    const order = state.orders.find((candidate) => candidate.orderId === orderId);
    if (!order || !unconfirmed.has(orderId)) return;

    try {
      const detail = await fetchSpotOrderById(orderId, {
        wallet: order.wallet,
        symbol: order.symbol,
      });
      applyOrderUpdate({ ...detail, orderId, symbol: detail.symbol || order.symbol });
    } catch {
      // The active-list refresh remains the fallback if this order-detail endpoint is unavailable
      // for an account or has not indexed the newly accepted order yet.
    }

    attempt += 1;
    const current = state.orders.find((candidate) => candidate.orderId === orderId);
    if (current && unconfirmed.has(orderId) && attempt < PLACED_ORDER_RECHECK_DELAYS_MS.length) {
      setTimeout(check, PLACED_ORDER_RECHECK_DELAYS_MS[attempt]);
    } else if (current && unconfirmed.has(orderId)) {
      // Refresh the authoritative active list after the short detail-check window. This keeps
      // genuinely open orders visible while allowing the regular reconciliation path to retire
      // any order that disappeared between the detail lookup and this snapshot.
      void loadOpenOrders(true);
    }
  };

  setTimeout(check, PLACED_ORDER_RECHECK_DELAYS_MS[0]);
}

/**
 * Merges one private-WebSocket order message. Feed it raw frames from the account feed; unknown
 * orders are adopted while live and ignored once terminal, so a fill that arrives without a
 * preceding "opened" still shows up.
 *
 * The frame's own fields are never trusted blindly — `state/orderUpdates` owns the rules that keep
 * a cumulative fill from shrinking and a finished row from coming back to life.
 */
export function applyOrderUpdate(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const raw = message as Record<string, unknown>;

  const incoming = normalizeOrder(raw);
  if (!incoming) return;

  const index = state.orders.findIndex((o) => o.orderId === incoming.orderId);
  if (index === -1) {
    // Adopt an order the app did not place only while it is live: a terminal frame for an unknown
    // order must not create a completed row in Open Orders.
    if (isTerminalStatus(incoming.status)) {
      terminalOrderIds.add(incoming.orderId);
    } else {
      emit({ orders: [incoming, ...state.orders] });
    }
    return;
  }

  const existing = state.orders[index]!;
  const { order: merged, filledChanged } = mergeOrderUpdate(existing, raw);

  if (isTerminalStatus(merged.status)) {
    // This is the Open Orders list: once KuCoin says the order is filled or cancelled, remove it
    // immediately instead of retaining terminal data in the shared store for a display linger.
    terminalOrderIds.add(merged.orderId);
    unconfirmed.delete(merged.orderId);
    emit({ orders: state.orders.filter((order) => order.orderId !== merged.orderId) });
  } else {
    const orders = [...state.orders];
    orders[index] = merged;
    emit({ orders });

    // Keep the pre-confirmation copy current, or the next refresh would carry a stale row back in
    // over the update that just arrived.
    if (unconfirmed.has(merged.orderId)) unconfirmed.set(merged.orderId, merged);
  }

  // Any fill moves money — a partial one just as much as a complete one — and a cancellation or
  // modification releases or re-freezes part of it. The balance feed reports the new figure, so
  // this only schedules the REST safety net for the case where the socket was not connected.
  if (filledChanged || isTerminalStatus(merged.status)) {
    reconcileBalanceAfterChange();
    // A fill also moves the cost basis: a buy raises the position's average entry, a sell that
    // closes it out clears it. Re-readfills shortly so the header's P&L chip follows along.
    scheduleCostBasisRefresh(merged.symbol);
  }
}

/**
 * Cancels one order and resolves to whether the exchange accepted it.
 *
 * The row stays put, dimmed, showing its own spinner, and leaves only once the cancel is
 * confirmed. Removing it optimistically instead would leave nothing on screen to show that
 * spinner on, and nothing to come back to if the exchange refuses.
 */
export async function cancelOpenOrder(orderId: string): Promise<boolean> {
  if (state.cancelling.has(orderId)) return false;
  const order = state.orders.find((o) => o.orderId === orderId);
  if (!order) return false;

  emit({ cancelling: new Set([...state.cancelling, orderId]), error: null });

  try {
    // The HF book refuses to cancel without the pair, and every row knows its own.
    await cancelOrder(orderId, { wallet: order.wallet, symbol: order.symbol });
    unconfirmed.delete(orderId);
    emit({ orders: state.orders.filter((o) => o.orderId !== orderId) });
    // Reconciles anything that filled or changed while the cancel was in flight.
    void loadOpenOrders();
    // The frozen funds are released on the exchange's side, and the balance feed pushes the new
    // figure directly; this re-reads once as a safety net.
    reconcileBalanceAfterChange();
    // A cancel can leave behind whatever filled before it, so the average needs re-reading too.
    scheduleCostBasisRefresh(order.symbol);
    return true;
  } catch (caught) {
    // Cancelling an order that already filled or was cancelled elsewhere comes back as
    // `order_not_exist_or_not_allow_to_cancel`. That is not a failure to show the user — the order
    // is simply no longer open, so retire the row and re-read instead of surfacing an error.
    if (isOrderGoneError(caught)) {
      unconfirmed.delete(orderId);
      emit({ orders: state.orders.filter((o) => o.orderId !== orderId), error: null });
      void loadOpenOrders();
      reconcileBalanceAfterChange();
      scheduleCostBasisRefresh(order.symbol);
      return true;
    }
    emit({ error: describeError(caught, 'Cancel failed.') });
    return false;
  } finally {
    const cancelling = new Set(state.cancelling);
    cancelling.delete(orderId);
    emit({ cancelling });
  }
}
