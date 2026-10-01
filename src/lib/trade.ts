/**
 * The arithmetic behind the order form, kept out of the component so it can be tested without a
 * renderer.
 *
 * Every amount stays a decimal string. The form's whole job is to move values between price,
 * size and total, fill them from a percentage of the balance, and step them by one tick — all of
 * which are exactly the operations a float gets subtly wrong at the last digit, and the last
 * digit is exactly what KuCoin rejects on.
 */
import { decimalsFromIncrement } from '@/utils/format';
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  snapToIncrement,
  subtractDecimal,
} from '@/utils/decimal';
import type { OrderSide, SymbolInfo } from './kucoin/types';

/** Percentages the balance slider snaps to. */
export const FILL_STOPS = [0, 25, 50, 75, 100] as const;
export type FillPercent = (typeof FILL_STOPS)[number];

export type Balances = {
  /** Free balance of the pair's base currency, funding a sell. */
  base: string;
  /** Free balance of the pair's quote currency, funding a buy. */
  quote: string;
};

export type FilledAmount = {
  size: string;
  total: string;
};

function sizeScale(rules: SymbolInfo): number {
  return decimalsFromIncrement(rules.baseIncrement);
}

/** Exported so the panel can gate its controls on exactly the test the fill maths itself uses. */
export function isPositive(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && compareDecimal(value, '0') === 1;
}

/**
 * The last traded price, quantized to the pair's tick. The socket delivers a number, and a number
 * cannot represent every tick exactly, so it is rendered at the increment's own decimal count and
 * then snapped before it is allowed into the price field.
 */
export function prefillPrice(rules: SymbolInfo, lastPrice: number | null | undefined): string | null {
  if (lastPrice === null || lastPrice === undefined || !Number.isFinite(lastPrice)) return null;
  const raw = lastPrice.toFixed(decimalsFromIncrement(rules.priceIncrement));
  return snapToIncrement(raw, rules.priceIncrement, 'nearest') ?? raw;
}

/** Moves a value one increment up or down, snapped first so a typed value steps predictably. */
export function stepAmount(value: string, increment: string, direction: 1 | -1): string {
  const snapped = snapToIncrement(value || '0', increment, 'nearest') ?? '0';
  const moved = direction === 1 ? addDecimal(snapped, increment) : subtractDecimal(snapped, increment);
  if (!isPositive(moved)) return '0';
  return moved;
}

/** Exact `price x size`, or `null` when either side is not a usable number. */
export function totalFromSize(price: string, size: string): string | null {
  if (!isPositive(price) || !isPositive(size)) return null;
  return multiplyDecimal(price, size);
}

/** Back-calculates `size` from an edited total, quantized to the base increment. */
export function sizeFromTotal(total: string, price: string, rules: SymbolInfo): string | null {
  if (!isPositive(total) || !isPositive(price)) return null;
  const raw = divideDecimal(total, price, sizeScale(rules), 'nearest');
  return raw === null ? null : snapToIncrement(raw, rules.baseIncrement, 'nearest');
}

/**
 * Largest order the balance supports, floored to the base increment so it can never exceed what
 * the user holds. A buy is priced first, because the balance is in the quote currency.
 */
export function maxSize(
  side: OrderSide,
  rules: SymbolInfo,
  price: string,
  balances: Balances
): string | null {
  if (side === 'sell') return snapToIncrement(balances.base, rules.baseIncrement, 'floor');
  if (!isPositive(price)) return null;
  const raw = divideDecimal(balances.quote, price, sizeScale(rules), 'floor');
  return raw === null ? null : snapToIncrement(raw, rules.baseIncrement, 'floor');
}

/**
 * Fills the form from a percentage of the available balance: base for a sell, quote-then-price for
 * a buy. Always floored, so dragging to 100% yields an order that fits rather than one that trips
 * the balance check.
 */
export function fillByPercent(
  side: OrderSide,
  percent: FillPercent,
  rules: SymbolInfo,
  price: string,
  balances: Balances
): FilledAmount | null {
  if (side === 'buy' && !isPositive(price)) return null;

  const portionSource = side === 'sell' ? balances.base : balances.quote;
  const portion = divideDecimal(
    multiplyDecimal(portionSource, String(percent)) ?? '0',
    '100',
    12,
    'floor'
  );
  if (portion === null) return null;

  const raw = side === 'sell' ? portion : divideDecimal(portion, price, sizeScale(rules), 'floor');
  if (raw === null) return null;

  const size = snapToIncrement(raw, rules.baseIncrement, 'floor');
  if (size === null) return null;
  const total = multiplyDecimal(price, size);
  return { size, total: total ?? '0' };
}
