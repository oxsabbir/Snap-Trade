/**
 * Pure validation for spot limit orders, run before anything touches the network.
 *
 * Every rule here mirrors a check KuCoin performs server-side (`priceIncrement`,
 * `baseIncrement`, `baseMinSize`, `quoteMinSize`, `minFunds`, `enableTrading`, available
 * balance). Catching them locally turns an opaque `102421`/`400100` rejection into a field-level
 * message and avoids burning a signed request on an order that cannot rest.
 *
 * The module takes decimal strings, never numbers, so the checks line up exactly with what the
 * exchange will compare against.
 */
import type { OrderSide, SymbolInfo } from './types';
import { addDecimal, compareDecimal, divideDecimal, isMultipleOf, multiplyDecimal, parseDecimal, snapToIncrement } from '@/utils/decimal';

export type { OrderSide };

export type LimitOrderDraft = {
  side: OrderSide;
  symbol: string;
  /** Limit price in quote currency, as entered. */
  price: string;
  /** Size in base currency, as entered. */
  size: string;
};

export type OrderIssueCode =
  | 'symbol-disabled'
  | 'price-invalid'
  | 'size-invalid'
  | 'price-increment'
  | 'size-increment'
  | 'size-min'
  | 'size-max'
  | 'total-min'
  | 'insufficient-balance';

export type OrderIssueField = 'symbol' | 'price' | 'size' | 'balance';

export type OrderIssue = {
  code: OrderIssueCode;
  field: OrderIssueField;
  message: string;
};

export type OrderBalances = {
  /** Spendable base currency, used to fund a sell. */
  base: string;
  /** Spendable quote currency, used to fund a buy. */
  quote: string;
};

export type OrderValidation = {
  valid: boolean;
  issues: OrderIssue[];
  /** Exact `price * size` in quote currency, or `null` if either field is malformed. */
  total: string | null;
  /** Values snapped to the symbol's increments, ready to submit. */
  normalized: { price: string; size: string } | null;
};

function positive(value: string | null): boolean {
  return value !== null && parseDecimal(value) !== null && compareDecimal(value, '0') === 1;
}

export function validateLimitOrder(
  draft: LimitOrderDraft,
  symbolInfo: SymbolInfo,
  balances: OrderBalances,
  takerFeeRate: string
): OrderValidation {
  const issues: OrderIssue[] = [];

  if (!symbolInfo.enableTrading) {
    issues.push({
      code: 'symbol-disabled',
      field: 'symbol',
      message: 'Trading is currently disabled for this pair.',
    });
    return { valid: false, issues, total: null, normalized: null };
  }

  const price = snapToIncrement(draft.price, symbolInfo.priceIncrement, 'nearest');
  const size = snapToIncrement(draft.size, symbolInfo.baseIncrement, 'nearest');

  if (!positive(draft.price)) {
    issues.push({
      code: 'price-invalid',
      field: 'price',
      message: 'Enter a price greater than zero.',
    });
  } else if (isMultipleOf(draft.price, symbolInfo.priceIncrement) === false) {
    issues.push({
      code: 'price-increment',
      field: 'price',
      message: `Price must be a multiple of ${symbolInfo.priceIncrement}.`,
    });
  }

  if (!positive(draft.size)) {
    issues.push({
      code: 'size-invalid',
      field: 'size',
      message: 'Enter a size greater than zero.',
    });
  } else {
    if (isMultipleOf(draft.size, symbolInfo.baseIncrement) === false) {
      issues.push({
        code: 'size-increment',
        field: 'size',
        message: `Size must be a multiple of ${symbolInfo.baseIncrement}.`,
      });
    }
    if (compareDecimal(draft.size, symbolInfo.baseMinSize) === -1) {
      issues.push({
        code: 'size-min',
        field: 'size',
        message: `Minimum size is ${symbolInfo.baseMinSize} ${symbolInfo.baseCurrency}.`,
      });
    }
    if (compareDecimal(draft.size, symbolInfo.baseMaxSize) === 1) {
      issues.push({
        code: 'size-max',
        field: 'size',
        message: `Maximum size is ${symbolInfo.baseMaxSize} ${symbolInfo.baseCurrency}.`,
      });
    }
  }

  const total = price !== null && size !== null ? multiplyDecimal(draft.price, draft.size) : null;

  if (total !== null) {
    const belowQuoteMin = compareDecimal(total, symbolInfo.quoteMinSize) === -1;
    const belowMinFunds = compareDecimal(total, symbolInfo.minFunds) === -1;
    if (belowQuoteMin || belowMinFunds) {
      const minimum = compareDecimal(symbolInfo.quoteMinSize, symbolInfo.minFunds) === 1
        ? symbolInfo.quoteMinSize
        : symbolInfo.minFunds;
      issues.push({
        code: 'total-min',
        field: 'size',
        message: `Order value must be at least ${minimum} ${symbolInfo.quoteCurrency}.`,
      });
    }

    const spendable = draft.side === 'buy' ? balances.quote : balances.base;
    
    // For buy orders, account for taker fees: effective balance = balance / (1 + fee)
    let required: string;
    if (draft.side === 'buy') {
      const effectiveBalance = divideDecimal(spendable, addDecimal('1', takerFeeRate) ?? '1', 12, 'floor');
      required = total;
      // Check if the required total (including fees) exceeds effective balance
      if (effectiveBalance !== null && compareDecimal(required, effectiveBalance) === 1) {
        issues.push({
          code: 'insufficient-balance',
          field: 'balance',
          message: `Not enough ${symbolInfo.quoteCurrency}. Available ${spendable}, required ${required} (incl. ${Number(takerFeeRate) * 100}% fee).`,
        });
      }
    } else {
      required = draft.size;
      if (compareDecimal(required, spendable) === 1) {
        issues.push({
          code: 'insufficient-balance',
          field: 'balance',
          message: `Not enough ${symbolInfo.baseCurrency}. Available ${spendable}, required ${required}.`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    total,
    normalized: price !== null && size !== null ? { price, size } : null,
  };
}