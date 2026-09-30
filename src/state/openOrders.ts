/**
 * Open orders, shared across the trade screen.
 *
 * The order form and the open-orders list are siblings under one route. An order placed in the
 * form has to show up in the list on the same tap, and a list that only learns about orders from
 * its own REST poll puts a network round trip between pressing Buy and seeing anything — which
 * reads as the button not working.
 *
 * So the state lives here instead of inside the list component. `TradePanel` pushes a freshly
 * placed order straight in, `OrderManagement` reads the same store, and a private WebSocket can
 * feed `applyOrderUpdate` when it is wired up. Same store-and-subscribe shape `state/ticker.ts`
 * uses for prices, so the list survives the list component unmounting and neither sibling has to
 * re-render the other.
 */
import { describeError } from '@/lib/kucoin/errors';
import { request } from '@/lib/kucoin/client';
import { cancelOrder, type SpotOrderWallet } from '@/lib/kucoin/orders';
import type { OrderSide } from '@/lib/kucoin/types';
import { refreshBalance, refreshBalanceAfterSettle } from '@/state/balance';

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
 */
const WS_STATUS: Record<string, OrderStatus> = {
  open: 'open',
  new: 'open',
  active: 'open',
  update: 'open',
  match: 'partially_filled',
  partfilled: 'partially_filled',
  partially_filled: 'partially_filled',
  filled: 'filled',
  done: 'filled',
  canceled: 'cancelled',
  cancelled: 'cancelled',
};

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
  if (mapped) {
    status = mapped === 'partially_filled' && fullyFilled ? 'filled' : mapped;
  } else if (typeof raw.isActive === 'boolean' || typeof raw.isActive === 'string') {
    const isActive = raw.isActive === true || raw.isActive === 'true';
    status = isActive
      ? filled > 0
        ? 'partially_filled'
        : 'open'
      : fullyFilled
        ? 'filled'
        : 'cancelled';
  } else {
    // Neither field present: fall back to how much of the size is already dealt.
    status = filled > 0 && !fullyFilled ? 'partially_filled' : 'open';
  }

  return {
    orderId,
    clientOid: raw.clientOid ? String(raw.clientOid) : undefined,
    symbol: String(raw.symbol ?? ''),
    side: (raw.side ?? 'buy') as OrderSide,
    type: (raw.type ?? 'limit') as 'limit' | 'market',
    price: String(raw.price ?? '0'),
    size,
    filledSize,
    status,
    wallet: (raw.wallet as SpotOrderWallet) ?? fallbackWallet,
    createdAt: Number(raw.createdAt ?? raw.ts ?? Date.now()),
    updatedAt: Number(raw.updatedAt ?? raw.ts ?? Date.now()),
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

/**
 * Replaces the list from the exchange's active orders, keeping any locally inserted order the
 * response has not caught up with yet. Concurrent calls share one request.
 *
 * Only the classic `trade` book is fetched, which is the book `placeLimitOrder` submits to by
 * default. `wallet` is carried on every row so a cancel still routes correctly if placement ever
 * funds from `trade_hf`.
 */
export function loadOpenOrders(force = false): Promise<void> {
  if (inFlight && !force) return inFlight;

  const run = (async () => {
    // A refresh that runs over rows the user can already see must not raise the loading flag,
    // or the list is replaced by a spinner every time a cancel reconciles.
    emit({ isLoading: state.orders.length === 0, error: null });
    try {
      const data = await request<unknown>('/orders', {
        signed: true,
        query: { status: 'active' },
      });
      const items = Array.isArray(data)
        ? data
        : Array.isArray((data as { items?: unknown } | null)?.items)
          ? ((data as { items: unknown[] }).items)
          : [];

      const rest = items
        .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
        .map((raw) => normalizeOrder(raw))
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
    // A fill spends the remainder and a cancellation gives it back, but the exchange settles
    // after the message arrives, so this needs the repeated read rather than a single one.
    refreshBalanceAfterSettle();
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
    await cancelOrder(orderId, { wallet: order.wallet });
    unconfirmed.delete(orderId);
    emit({ orders: state.orders.filter((o) => o.orderId !== orderId) });
    // Reconciles anything that filled or changed while the cancel was in flight.
    void loadOpenOrders();
    // The frozen funds are released on the exchange's side, not ours, so a read taken now still
    // shows the pre-cancel balance. This re-reads a few times so the number catches up.
    refreshBalanceAfterSettle();
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
