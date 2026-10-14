/**
 * Pure order-history parsing and ordering, kept apart from the store so it can be reasoned about
 * and tested without React Native or a network — the same split `state/orderUpdates` uses for the
 * live list.
 *
 * Both spot books describe a finished order almost identically: the dealt amount is `dealSize`, the
 * dealt funds are `dealFunds`, and the row is identified by `id`. The one thing that differs is the
 * active flag — the classic book spells it `isActive`, the HF book `active` — and both are accepted.
 */
import type { SpotOrderWallet } from '@/lib/kucoin/orders';
import type { OrderSide } from '@/lib/kucoin/types';
import { compareDecimal, divideDecimal } from '@/utils/decimal';

export type HistoryStatus = 'open' | 'filled' | 'cancelled';

export type OrderHistoryEntry = {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: 'limit' | 'market';
  /** The order's limit price; `'0'` for a market order. */
  price: string;
  size: string;
  filledSize: string;
  dealFunds: string;
  /**
   * Blended execution price, `dealFunds / filledSize`, or `null` when nothing was dealt — a
   * cancellation that never filled has no execution price to report.
   */
  avgPrice: string | null;
  status: HistoryStatus;
  wallet: SpotOrderWallet;
  createdAt: number;
  updatedAt: number;
};

/** Reads a value KuCoin may send as either a string or a number. */
function fieldString(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isPositive(value: string): boolean {
  const result = compareDecimal(value, '0');
  return result !== null && result > 0;
}

function isAtLeast(a: string, b: string): boolean {
  const result = compareDecimal(a, b);
  return result !== null && result >= 0;
}

/**
 * A historized row is finished, so its status only has to separate a fill from a cancellation:
 * everything dealt is `filled`, anything less is `cancelled` (a partially filled order that was
 * then cancelled keeps the size it did deal, which is why the numbers — not a word — decide).
 */
function resolveHistoryStatus(
  raw: Record<string, unknown>,
  size: string,
  filledSize: string
): HistoryStatus {
  const activeFlag = raw.isActive ?? raw.active;
  if (activeFlag === true || activeFlag === 'true') return 'open';
  return isPositive(size) && isAtLeast(filledSize, size) ? 'filled' : 'cancelled';
}

function resolveOrderType(raw: Record<string, unknown>): 'limit' | 'market' {
  const word = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  return word === 'market' ? 'market' : 'limit';
}

/**
 * Normalizes one row from either book's completed-order response. Returns `null` for a row with no
 * id, which is the only field that cannot be inferred.
 */
export function normalizeHistoryOrder(
  raw: Record<string, unknown>,
  fallbackWallet: SpotOrderWallet = 'trade'
): OrderHistoryEntry | null {
  const orderId = fieldString(raw, 'id', 'orderId');
  if (!orderId) return null;

  const size = fieldString(raw, 'size', 'originSize') ?? '0';
  const filledSize = fieldString(raw, 'dealSize', 'filledSize') ?? '0';
  const dealFunds = fieldString(raw, 'dealFunds') ?? '0';
  const wallet = raw.wallet === 'trade_hf' || raw.wallet === 'trade' ? raw.wallet : fallbackWallet;
  const now = Date.now();

  return {
    orderId,
    symbol: fieldString(raw, 'symbol') ?? '',
    side: fieldString(raw, 'side') === 'sell' ? 'sell' : 'buy',
    type: resolveOrderType(raw),
    price: fieldString(raw, 'price') ?? '0',
    size,
    filledSize,
    dealFunds,
    avgPrice:
      isPositive(filledSize) && isPositive(dealFunds)
        ? divideDecimal(dealFunds, filledSize, 12, 'floor')
        : null,
    status: resolveHistoryStatus(raw, size, filledSize),
    wallet,
    createdAt: toNumber(raw.createdAt ?? raw.orderTime, now),
    updatedAt: toNumber(raw.updatedAt ?? raw.lastUpdatedAt ?? raw.createdAt, now),
  };
}

/** Newest first, with the same order id appearing in both books kept once. */
export function sortAndDedupeHistory(entries: OrderHistoryEntry[]): OrderHistoryEntry[] {
  const byId = new Map<string, OrderHistoryEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.orderId)) byId.set(entry.orderId, entry);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}
