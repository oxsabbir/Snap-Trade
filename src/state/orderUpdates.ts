/**
 * Pure order-normalization and merge logic, kept apart from the store so it can be reasoned about
 * and tested without React Native or a network.
 *
 * Two shapes arrive here and they disagree about almost everything:
 *
 *   - REST active orders (classic `dealSize`/`isActive`, HF `dealSize`/`active`) — a snapshot.
 *   - `/spotMarket/tradeOrdersV2` frames (`filledSize`/`remainSize`/`status`/`type`) — an event.
 *
 * The frame's `type` is the *message kind* (`received`, `open`, `match`, `update`, `filled`,
 * `canceled`) while `status` is the order's state in the matching system (`new`, `open`, `match`,
 * `done`). Reading `type` as the order kind is the trap: it makes every live row look like an order
 * of type "match".
 *
 * Frames are not deltas. `filledSize` is the cumulative amount already dealt and `remainSize` the
 * amount still outstanding, so a single frame is a complete answer for that order. That is exactly
 * why a sparse `received` frame — which carries no size figures at all — must never be allowed to
 * overwrite a fill the row already knows about. Guarding that is the whole point of `mergeOrderUpdate`.
 */
import { compareDecimal, subtractDecimal } from '@/utils/decimal';

import type { SpotOrderWallet } from '@/lib/kucoin/orders';
import type { OrderSide } from '@/lib/kucoin/types';

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

/**
 * KuCoin's WebSocket `status` vocabulary. `match` is reported for every fill event including the
 * one that completes the order, so it only means "partially filled" while some size is still
 * outstanding. `done` covers both a complete fill and a cancellation and is resolved against the
 * numbers rather than trusted as-is.
 */
const WS_STATUS: Record<string, OrderStatus> = {
  open: 'open',
  new: 'open',
  active: 'open',
  match: 'partially_filled',
  partfilled: 'partially_filled',
  partially_filled: 'partially_filled',
  filled: 'filled',
  done: 'filled', // fallback; the numbers decide in `resolveStatus`
  canceled: 'cancelled',
  cancelled: 'cancelled',
};

/** Reads a value that KuCoin may send as either a string or a number. */
function fieldString(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** True when the frame actually carried a usable value for `key`, as opposed to omitting it. */
function hasValue(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  return value !== undefined && value !== null && value !== '';
}

function compare(a: string, b: string): number {
  return compareDecimal(a, b) ?? 0;
}

function atLeast(a: string, b: string): boolean {
  return (compareDecimal(a, b) ?? 0) >= 0;
}

function greaterThanZero(a: string): boolean {
  const result = compareDecimal(a, '0');
  return result !== null && result > 0;
}

function messageKind(raw: Record<string, unknown>): string {
  return typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
}

function orderStatusWord(raw: Record<string, unknown>): string {
  return typeof raw.status === 'string' ? raw.status.toLowerCase() : '';
}

/**
 * The one case the status word cannot decide on its own: `done` means the matching system is
 * finished, which is either a complete fill or a cancellation. Which one is inferred from whether
 * any size is still outstanding.
 */
function statusFromWebSocketMessage(raw: Record<string, unknown>, fullyFilled: boolean): OrderStatus | null {
  const kind = messageKind(raw);
  const word = orderStatusWord(raw);

  if (kind === 'filled') return 'filled';
  if (kind === 'canceled' || kind === 'cancelled') {
    // A cancellation still reports the size that had already been dealt, so a part-filled order
    // that was then cancelled must read as cancelled, not filled.
    return fullyFilled ? 'filled' : 'cancelled';
  }
  // `type: "update"` + `status: "done"` is another terminal path KuCoin uses to finish an order.
  if (kind === 'update' && word === 'done') {
    return fullyFilled ? 'filled' : 'cancelled';
  }
  return null;
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'filled' || status === 'cancelled';
}

/** Monotonic precedence so a later, sparser frame can never drag a row backwards. */
const STATUS_RANK: Record<OrderStatus, number> = {
  open: 0,
  partially_filled: 1,
  filled: 2,
  cancelled: 2,
};

/**
 * Resolves an order's status from the numbers first and the status word second.
 *
 * The dealt amount is authoritative: if `filledSize` has reached `size` the order is filled no
 * matter what any field says, which is what keeps a fully-dealt row from sitting on a progress bar
 * that never reaches the end. The vocabulary field only breaks ties the numbers cannot.
 */
export function resolveStatus(
  raw: Record<string, unknown>,
  size: string,
  filledSize: string
): OrderStatus {
  const kind = messageKind(raw);
  const isCanceled = kind === 'canceled' || kind === 'cancelled' || greaterThanZero(fieldString(raw, 'canceledSize') ?? '0');
  const remain = fieldString(raw, 'remainSize');
  const remainIsZero = !isCanceled && remain !== null && (compareDecimal(remain, '0') ?? 1) <= 0;
  const fullyFilled = remainIsZero || (greaterThanZero(size) && atLeast(filledSize, size));

  const fromMessage = statusFromWebSocketMessage(raw, fullyFilled);
  if (fromMessage) return fromMessage;

  const word = orderStatusWord(raw);
  const mapped = WS_STATUS[word];

  if (word === 'done') return fullyFilled ? 'filled' : 'cancelled';

  if (mapped) {
    if (mapped === 'cancelled') return fullyFilled ? 'filled' : 'cancelled';
    if (fullyFilled) return 'filled';
    if (mapped === 'partially_filled' || greaterThanZero(filledSize)) return 'partially_filled';
    return 'open';
  }

  const activeFlag = raw.isActive ?? raw.active;
  if (typeof activeFlag === 'boolean' || typeof activeFlag === 'string') {
    const isActive = activeFlag === true || activeFlag === 'true';
    if (!isActive) return fullyFilled ? 'filled' : 'cancelled';
  }

  return fullyFilled ? 'filled' : greaterThanZero(filledSize) ? 'partially_filled' : 'open';
}

/**
 * REST classic orders spell the order type `type`; WebSocket frames spell it `orderType` and use
 * `type` for the message kind. Only accept `limit`/`market`, so a message kind can never be
 * mistaken for an order type.
 */
function resolveOrderType(raw: Record<string, unknown>): 'limit' | 'market' {
  const explicit = typeof raw.orderType === 'string' ? raw.orderType.toLowerCase() : '';
  if (explicit === 'limit' || explicit === 'market') return explicit;

  const word = messageKind(raw);
  if (word === 'limit' || word === 'market') return word;

  return 'limit';
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Accepts both order shapes KuCoin sends. `fallbackWallet` supplies the wallet for REST rows, which
 * never carry one; WebSocket frames keep the wallet the store already stamped on the row.
 */
export function normalizeOrder(
  raw: Record<string, unknown>,
  fallbackWallet: SpotOrderWallet = 'trade'
): OpenOrder | null {
  const orderId = fieldString(raw, 'orderId', 'id');
  if (!orderId) return null;

  const size = fieldString(raw, 'size', 'originSize') ?? '0';
  let filledSize = fieldString(raw, 'filledSize', 'dealSize') ?? '0';

  const kind = messageKind(raw);
  const isCanceled = kind === 'canceled' || kind === 'cancelled' || greaterThanZero(fieldString(raw, 'canceledSize') ?? '0');
  const remain = fieldString(raw, 'remainSize');
  const remainIsZero = !isCanceled && remain !== null && (compareDecimal(remain, '0') ?? 1) <= 0;

  if (remainIsZero && greaterThanZero(size)) {
    filledSize = size;
  } else if (remain !== null && greaterThanZero(remain) && greaterThanZero(size) && atLeast(size, remain)) {
    const derived = subtractDecimal(size, remain);
    if (derived && atLeast(derived, filledSize)) {
      filledSize = derived;
    }
  } else if (filledSize === '0') {
    const fillOrMatch = fieldString(raw, 'fillSize', 'matchSize');
    if (fillOrMatch && greaterThanZero(size) && atLeast(fillOrMatch, size)) {
      filledSize = size;
    }
  }

  const wallet = raw.wallet === 'trade_hf' || raw.wallet === 'trade' ? raw.wallet : fallbackWallet;
  const now = Date.now();

  return {
    orderId,
    clientOid: fieldString(raw, 'clientOid') ?? undefined,
    symbol: fieldString(raw, 'symbol') ?? '',
    side: fieldString(raw, 'side') === 'sell' ? 'sell' : 'buy',
    type: resolveOrderType(raw),
    price: fieldString(raw, 'price') ?? '0',
    size,
    filledSize,
    status: resolveStatus(raw, size, filledSize),
    wallet,
    createdAt: toNumber(raw.createdAt ?? raw.ts, now),
    updatedAt: toNumber(raw.updatedAt ?? raw.lastUpdatedAt ?? raw.ts, now),
  };
}

export type OrderMergeResult = { order: OpenOrder; filledChanged: boolean };

/**
 * Merges one private-WebSocket frame into the row the store already holds.
 *
 * Every field the frame omits keeps the value the row had, and every field it does carry must not
 * move the row backwards: `filledSize` is cumulative and monotonic, and a terminal status is final.
 * This is what stops a sparse `received` frame from resetting a partial fill to `0 / size`.
 */
export function mergeOrderUpdate(
  existing: OpenOrder,
  raw: Record<string, unknown>
): OrderMergeResult {
  const incoming = normalizeOrder(raw, existing.wallet);
  if (!incoming) return { order: existing, filledChanged: false };

  const size = hasValue(raw, 'size') || hasValue(raw, 'originSize') ? incoming.size : existing.size;

  const kind = messageKind(raw);
  const isCanceled = kind === 'canceled' || kind === 'cancelled' || greaterThanZero(fieldString(raw, 'canceledSize') ?? '0');
  const remain = fieldString(raw, 'remainSize');
  const remainIsZero = !isCanceled && remain !== null && (compareDecimal(remain, '0') ?? 1) <= 0;

  let filledSize = existing.filledSize;
  if (remainIsZero && greaterThanZero(size)) {
    filledSize = size;
  } else if (remain !== null && greaterThanZero(remain) && greaterThanZero(size) && atLeast(size, remain)) {
    const derived = subtractDecimal(size, remain);
    if (derived && atLeast(derived, existing.filledSize)) {
      filledSize = derived;
    }
  } else if ((hasValue(raw, 'filledSize') || hasValue(raw, 'dealSize')) && atLeast(incoming.filledSize, existing.filledSize)) {
    filledSize = incoming.filledSize;
  } else if (hasValue(raw, 'fillSize') || hasValue(raw, 'matchSize')) {
    const fillOrMatch = fieldString(raw, 'fillSize', 'matchSize');
    if (fillOrMatch && greaterThanZero(size) && atLeast(fillOrMatch, size)) {
      filledSize = size;
    }
  }

  if (greaterThanZero(size) && atLeast(filledSize, size)) {
    filledSize = size;
  }

  const resolved = resolveStatus(raw, size, filledSize);
  // A terminal row is finished and stays that way; otherwise status may only climb.
  let status = existing.status;
  if (!isTerminalStatus(existing.status) && STATUS_RANK[resolved] >= STATUS_RANK[existing.status]) {
    status = resolved;
  }
  if (!isCanceled && (remainIsZero || (greaterThanZero(size) && atLeast(filledSize, size)))) {
    status = 'filled';
  }

  const order: OpenOrder = {
    ...existing,
    clientOid: incoming.clientOid ?? existing.clientOid,
    symbol: incoming.symbol || existing.symbol,
    side: hasValue(raw, 'side') ? incoming.side : existing.side,
    type: hasValue(raw, 'orderType') ? incoming.type : existing.type,
    price: hasValue(raw, 'price') && incoming.price !== '0' ? incoming.price : existing.price,
    size,
    filledSize,
    status,
    wallet: existing.wallet,
    createdAt: existing.createdAt,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };

  return { order, filledChanged: compare(filledSize, existing.filledSize) !== 0 };
}

/**
 * Merges an authoritative REST active-order row into the row the store already holds.
 *
 * REST is the baseline after a reconnect or a foreground, but the snapshot it carries can predate a
 * WebSocket fill that has since arrived. Replacing the row wholesale would then wipe the newer fill
 * back off the screen — the same "stale fill" symptom, from a different source. So the snapshot wins
 * on identity and price, while a fill it does not know about and a terminal status it is too old to
 * reflect are preserved.
 */
export function mergeRestSnapshot(existing: OpenOrder, snapshot: OpenOrder): OpenOrder {
  const size = snapshot.size !== '0' ? snapshot.size : existing.size;
  const filledSize = atLeast(snapshot.filledSize, existing.filledSize)
    ? snapshot.filledSize
    : existing.filledSize;

  let status = existing.status;
  if (!isTerminalStatus(existing.status) && STATUS_RANK[snapshot.status] >= STATUS_RANK[existing.status]) {
    status = snapshot.status;
  }
  // A fill the snapshot has already accounted for still wins over a stale non-terminal rank.
  if (atLeast(filledSize, size) && greaterThanZero(size)) status = 'filled';

  return { ...snapshot, size, filledSize, status };
}
