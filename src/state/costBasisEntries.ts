/**
 * Decimal-safe cost-basis bookkeeping for one trading pair.
 *
 * KuCoin's private API exposes fills but no cost basis, so the average entry price of a position
 * has to be reconstructed from its trade history. This module owns that arithmetic and nothing
 * else: no storage, no network, no React. It is pure so every method can be tested directly.
 *
 * Method is weighted average. A buy adds its base size and its quote cost. A sell removes base
 * size and removes cost in proportion (`cost * remaining / before`), which leaves the average
 * untouched — the whole point of a weighted average. Selling everything resets the ledger.
 */

import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
} from '@/utils/decimal';
import type { Fill } from '@/lib/kucoin/fills';

/** A fill reduced to what the ledger needs: which way, how much base, how much quote cost. */
export type ParsedFill = {
  id: string;
  createdAt: number;
  side: 'buy' | 'sell';
  /** Base quantity the trade adds (buy) or removes (sell). Always positive. */
  qty: string;
  /** Quote cost of the purchase; ignored on sells. Never negative. */
  cost: string;
};

/** Running ledger for a single symbol. All amounts are decimal strings. */
export type CostLedger = {
  /** Net base quantity held per this ledger. */
  qty: string;
  /** Quote cost still attributed to `qty`. */
  cost: string;
  /** Newest applied fill's `createdAt` in ms; `0` before any fill. */
  cursor: number;
  /** Ids applied at exactly `cursor`, so a `startAt`-overlapping refetch is not double-counted. */
  cursorIds: string[];
};

export function emptyLedger(): CostLedger {
  return { qty: '0', cost: '0', cursor: 0, cursorIds: [] };
}

/** `compareDecimal` returns `null` only for malformed input; callers validate first. */
function cmp(a: string, b: string): number {
  return compareDecimal(a, b) ?? 0;
}

function isPositive(value: string): boolean {
  return cmp(value, '0') > 0;
}

/**
 * KuCoin classic fills report `createdAt` in milliseconds but some books hand back nanoseconds.
 * Values beyond the millisecond epoch ceiling are scaled down so ordering and the cursor stay
 * comparable.
 */
export function normalizeCreatedAt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value > 1e15 ? Math.floor(value / 1e6) : value;
}

/**
 * Turns a raw fill into the two numbers the ledger needs, or `null` when it cannot be counted:
 * malformed size/price, or a fee paid in a currency that is neither leg's (e.g. KCS), which would
 * silently misstate the cost. Fees in the base leg reduce the received size on a buy and add to the
 * spent size on a sell; a quote fee adds to a buy's cost. Sell proceeds never enter the cost basis.
 */
export function toParsedFill(
  fill: Fill,
  base: string,
  quote: string
): ParsedFill | null {
  const size = fill.size;
  const price = fill.price;
  if (!size || !price) return null;
  if (cmp(size, '0') <= 0) return null;

  // `funds` is the quote value KuCoin reports for the deal; fall back to price * size when absent.
  const gross = fill.funds && cmp(fill.funds, '0') > 0 ? fill.funds : multiplyDecimal(price, size);
  if (gross === null) return null;

  const fee = fill.fee && cmp(fill.fee, '0') > 0 ? fill.fee : null;
  const feeInBase = fee !== null && !!base && fill.feeCurrency === base;
  const feeInQuote = fee !== null && !!quote && fill.feeCurrency === quote;

  if (fill.side === 'buy') {
    const qty = feeInBase ? addDecimal(size, `-${fee}`) : size;
    const cost = feeInQuote ? addDecimal(gross, fee) : gross;
    if (qty === null || cost === null || !isPositive(qty)) return null;
    return { id: fill.tradeId, createdAt: normalizeCreatedAt(fill.createdAt), side: 'buy', qty, cost };
  }

  const qty = feeInBase ? addDecimal(size, fee) : size;
  if (qty === null || !isPositive(qty)) return null;
  return {
    id: fill.tradeId,
    createdAt: normalizeCreatedAt(fill.createdAt),
    side: 'sell',
    qty,
    cost: '0',
  };
}

/** Applies one parsed fill to a ledger, returning a new ledger. */
export function applyFill(ledger: CostLedger, fill: ParsedFill): CostLedger {
  if (fill.side === 'buy') {
    const qty = addDecimal(ledger.qty, fill.qty);
    const cost = addDecimal(ledger.cost, fill.cost);
    if (qty === null || cost === null) return ledger;
    return { ...ledger, qty, cost };
  }

  // Sell: cost leaves in proportion to the size that left, leaving the average unchanged.
  if (cmp(fill.qty, ledger.qty) >= 0) {
    return { ...ledger, qty: '0', cost: '0' };
  }
  const remaining = subtractDecimal(ledger.qty, fill.qty);
  if (remaining === null) return ledger;
  const ratio = divideDecimal(remaining, ledger.qty, 18, 'floor');
  if (ratio === null) return ledger;
  const cost = multiplyDecimal(ledger.cost, ratio);
  if (cost === null) return ledger;
  return { ...ledger, qty: remaining, cost };
}

/** Average cost per base unit as a decimal string, or `null` when the position is flat. */
export function averageCost(ledger: CostLedger): string | null {
  if (!isPositive(ledger.qty)) return null;
  return divideDecimal(ledger.cost, ledger.qty, 18, 'floor');
}

/**
 * Folds a batch of raw fills into a ledger. Fills already reflected in the cursor are skipped, the
 * rest are applied oldest-first so the average matches chronological execution regardless of the
 * order the API returned them in. The cursor advances to the newest applied fill; ids applied at
 * exactly that timestamp are remembered so a `startAt`-overlapping refetch is not double-counted.
 */
export function absorbFills(
  ledger: CostLedger,
  fills: Fill[],
  base: string,
  quote: string
): CostLedger {
  const pending: ParsedFill[] = [];
  for (const raw of fills) {
    const parsed = toParsedFill(raw, base, quote);
    if (!parsed) continue;
    if (parsed.createdAt < ledger.cursor) continue;
    if (parsed.createdAt === ledger.cursor && ledger.cursorIds.includes(parsed.id)) continue;
    pending.push(parsed);
  }
  if (pending.length === 0) return ledger;

  pending.sort((a, b) => a.createdAt - b.createdAt);

  let next = ledger;
  for (const fill of pending) next = applyFill(next, fill);

  const newest = pending[pending.length - 1]!;
  const atCursor = pending
    .filter((fill) => fill.createdAt === newest.createdAt)
    .map((fill) => fill.id);
  // A fill sharing the previous cursor's timestamp extends that timestamp's id set rather than
  // replacing it, so a later refetch still recognises everything already counted at that instant.
  const cursorIds =
    newest.createdAt === ledger.cursor ? [...new Set([...ledger.cursorIds, ...atCursor])] : atCursor;

  return { ...next, cursor: newest.createdAt, cursorIds };
}
