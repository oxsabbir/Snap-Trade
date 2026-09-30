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
 */
import { describeError } from '@/lib/kucoin/errors';
import {
  cancelOrder,
  fetchClassicOpenOrders,
  fetchHighFrequencyOpenOrders,
  fetchHighFrequencyOrderSymbols,
  type SpotOrderWallet,
} from '@/lib/kucoin/orders';
import type { OrderSide } from '@/lib/kucoin/types';
import { refreshBalance, reconcileBalanceAfterChange } from '@/state/balance';

export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

export type OpenOrder = {
  orderId: string;
  clientOid?: string;
  symbol: string;
  side: OrderSide;
  type: 'limit' | 'market';
  price: string;
  size: string;
  filledSize: string;
  status: OrderStatus;
  /** Which spot book funds it, so a cancel is sent back to the endpoint that owns the order. */
  wallet: SpotOrderWallet;
  createdAt: number;
  updatedAt: number;
};

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

/** How long a filled or cancelled row stays on screen, so the outcome is readable. */
const TERMINAL_LINGER_MS = 2500;

let state: OpenOrdersState = INITIAL_STATE;
const listeners = new Set<() => void>();

/**
 * Orders inserted locally before the exchange confirmed them. A refresh merges these back in so
 * a row does not blink out of existence in the gap between placement and the first response that
 * includes it.
 */
const unconfirmed = new Map<string, OpenOrder>();

/** Pending auto-removal of terminal rows, keyed by order id so a cancel can pre-empt one. */
const removals = new Map<string, ReturnType<typeof setTimeout>>();

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

/**
 * KuCoin's WebSocket `status` vocabulary, which does not match the REST shape. `match` is
 * reported for every fill event including the one that completes the order, so it only means
 * "partially filled" while some size is still outstanding.
 *
 * `done` is the WebSocket's word for "the matching system is finished with this order" and covers
 * both a complete fill and a cancellation. Which one it was has to be inferred from how much size
 * is still outstanding, because the status itself does not say.
 */
const WS_STATUS: Record<string, OrderStatus> = {
  open: 'open',
  new: 'open',
  active: 'open',
  match: 'partially_filled',
  partfilled: 'partially_filled',
  partially_filled: 'partially_filled',
  filled: 'filled',
  canceled: 'cancelled',
  cancelled: 'cancelled',
};

/**
 * `/spotMarket/tradeOrdersV2` frames carry two separate fields that are easy to confuse: `type` is
 * the *message* kind (`received`, `open`, `match`, `update`, `filled`, `canceled`) and `status` is
 * the order's state in the matching system (`new`, `open`, `match`, `done`). Reading `type` as the
 * order kind is the trap — it makes every live row look like it was placed with an order type
 * called "match".
 *
 * The message kind is only useful for `done`, because that is the one case where the status alone
 * cannot tell a fill from a cancellation.
 */
function statusFromWebSocketMessage(raw: Record<string, unknown>, fullyFilled: boolean): OrderStatus | null {
  const messageType = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  if (messageType !== 'filled' && messageType !== 'canceled' && messageType !== 'cancelled') {
    return null;
  }
  if (messageType === 'filled') return 'filled';
  // "canceled" still reports the size that had already been dealt, so a part-filled order that
  // was then cancelled ends up `filled: false` and is a cancellation, not a fill.
  return fullyFilled ? 'filled' : 'cancelled';
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'filled' || status === 'cancelled';
}

/**
 * Accepts both order shapes KuCoin sends, because they disagree about how to say "finished":
 * the REST list carries `isActive` and no status, while a WebSocket update carries `status` and
 * no `isActive`. Reading only `isActive` marks every WebSocket message terminal, since a missing
 * boolean is not `true`.
 */
export function normalizeOrder(
  raw: Record<string, unknown>,
  fallbackWallet: SpotOrderWallet = 'trade'
): OpenOrder | null {
  const orderId = String(raw.orderId ?? raw.id ?? '');
  if (!orderId) return null;

  const size = String(raw.size ?? '0');
  const filledSize = String(raw.dealSize ?? raw.filledSize ?? '0');
  const filled = Number(filledSize);
  const total = Number(size);
  const fullyFilled = total > 0 && filled >= total;

  const rawStatus = typeof raw.status === 'string' ? raw.status.toLowerCase() : '';
  const mapped = WS_STATUS[rawStatus];

  let status: OrderStatus;
  // The message kind wins when it says the order finished, because it distinguishes a fill from a
  // cancellation that `status: "done"` alone cannot.
  const fromMessage = statusFromWebSocketMessage(raw, fullyFilled);
  if (fromMessage) {
    status = fromMessage;
  } else if (mapped) {
    status = mapped === 'partially_filled' && fullyFilled ? 'filled' : mapped;
  } else if (
    typeof raw.isActive === 'boolean' ||
    typeof raw.isActive === 'string' ||
    // The HF book spells it `active` where the classic book spells it `isActive`.
    typeof raw.active === 'boolean' ||
    typeof raw.active === 'string'
  ) {
    const flag = raw.isActive ?? raw.active;
    const isActive = flag === true || flag === 'true';
    if (!isActive) {
      status = fullyFilled ? 'filled' : 'cancelled';
    } else if (fullyFilled) {
      // A book can still report an order as active for the moment between the last fill landing
      // and the matching engine retiring it. Its size is all dealt, so calling it "partially
      // filled" would be wrong and would leave the row showing a bar that never reaches the end.
      status = 'filled';
    } else {
      status = filled > 0 ? 'partially_filled' : 'open';
    }
  } else {
    // Neither field present: fall back to how much of the size is already dealt.
    status = filled > 0 && !fullyFilled ? 'partially_filled' : 'open';
  }

  return {
    orderId,
    clientOid: raw.clientOid ? String(raw.clientOid) : undefined,
    symbol: String(raw.symbol ?? ''),
    side: (raw.side ?? 'buy') as OrderSide,
    type: ((raw.orderType ?? raw.type ?? 'limit') as 'limit' | 'market'),
    price: String(raw.price ?? '0'),
    size,
    filledSize,
    status,
    wallet: (raw.wallet as SpotOrderWallet) ?? fallbackWallet,
    createdAt: Number(raw.createdAt ?? raw.ts ?? Date.now()),
    updatedAt: Number(raw.updatedAt ?? raw.lastUpdatedAt ?? raw.ts ?? Date.now()),
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
        .filter((order): order is OpenOrder => order !== null);

      emit({ orders: [...rest, ...reconcileUnconfirmed(rest)], error: null });
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

  unconfirmed.set(order.orderId, order);
  emit({
    orders: [order, ...state.orders.filter((o) => o.orderId !== order.orderId)],
    error: null,
  });

  // Placing freezes the funds straight away, so the spendable balance has already moved.
  refreshBalance();
}

function scheduleRemoval(orderId: string): void {
  if (removals.has(orderId)) return;
  removals.set(
    orderId,
    setTimeout(() => {
      removals.delete(orderId);
      unconfirmed.delete(orderId);
      emit({ orders: state.orders.filter((o) => o.orderId !== orderId) });
    }, TERMINAL_LINGER_MS)
  );
}

/**
 * Merges one private-WebSocket order message. Feed it raw frames from the account feed; unknown
 * orders are adopted while live and ignored once terminal, so a fill that arrives without a
 * preceding "opened" still shows up.
 */
export function applyOrderUpdate(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const incoming = normalizeOrder(message as Record<string, unknown>);
  if (!incoming) return;

  const index = state.orders.findIndex((o) => o.orderId === incoming.orderId);
  if (index === -1) {
    if (!isTerminalStatus(incoming.status)) {
      emit({ orders: [incoming, ...state.orders] });
    }
    return;
  }

  const existing = state.orders[index]!;
  const merged: OpenOrder = {
    ...existing,
    ...incoming,
    // An update frame carries only what changed, so anything it omits or sends as zero keeps the
    // value the row already had. `wallet` never comes from a feed message.
    clientOid: incoming.clientOid ?? existing.clientOid,
    symbol: incoming.symbol || existing.symbol,
    price: incoming.price !== '0' ? incoming.price : existing.price,
    size: incoming.size !== '0' ? incoming.size : existing.size,
    filledSize: incoming.filledSize,
    wallet: existing.wallet,
    status: incoming.status,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };

  const orders = [...state.orders];
  orders[index] = merged;
  emit({ orders });

  // Keep the pre-confirmation copy current, or the next refresh would carry a stale row back in
  // over the update that just arrived.
  if (unconfirmed.has(merged.orderId)) unconfirmed.set(merged.orderId, merged);

  if (isTerminalStatus(merged.status)) {
    scheduleRemoval(merged.orderId);
  }

  // Any fill moves money — a partial one just as much as a complete one — and a cancellation or
  // modification releases or re-freezes part of it. The balance feed reports the new figure, so
  // this only schedules the REST safety net for the case where the socket was not connected.
  if (incoming.filledSize !== existing.filledSize || isTerminalStatus(merged.status)) {
    reconcileBalanceAfterChange();
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

  const pendingRemoval = removals.get(orderId);
  if (pendingRemoval) {
    clearTimeout(pendingRemoval);
    removals.delete(orderId);
  }

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
    return true;
  } catch (caught) {
    emit({ error: describeError(caught, 'Cancel failed.') });
    return false;
  } finally {
    const cancelling = new Set(state.cancelling);
    cancelling.delete(orderId);
    emit({ cancelling });
  }
}
