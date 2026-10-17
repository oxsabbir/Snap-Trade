/**
 * Unit tests for the cost-basis ledger.
 *
 * Offline, no API key. They pin down the weighted-average rules the Assets tab depends on: a buy
 * adds size and cost at its executed price, a sell removes cost in proportion and leaves the
 * average alone, a full exit resets, fees are left out of the average, and the cursor stops a
 * refetched page from being counted twice.
 *
 *   bun src/state/costBasisEntries.test.ts
 */
import type { Fill } from '@/lib/kucoin/fills';
import {
  absorbFills,
  applyFill,
  averageCost,
  emptyLedger,
  normalizeCreatedAt,
  toParsedFill,
  type CostLedger,
} from './costBasisEntries';

const tests: { name: string; run: () => void }[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}
function fail(message: string): never {
  throw new Error(message);
}
function eq(actual: unknown, expected: unknown): void {
  if (actual !== expected) fail(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function fill(over: Partial<Fill> = {}): Fill {
  return {
    tradeId: 't1',
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    price: '100',
    size: '2',
    funds: '200',
    fee: '0',
    feeCurrency: 'USDT',
    createdAt: 1000,
    ...over,
  };
}

function ledger(over: Partial<CostLedger> = {}): CostLedger {
  return { ...emptyLedger(), ...over };
}

// --- parsing ------------------------------------------------------------------------------------

test('a buy stores size as quantity and price times size as cost', () => {
  const parsed = toParsedFill(fill());
  if (!parsed) return fail('expected a parsed fill');
  eq(parsed.side, 'buy');
  eq(parsed.qty, '2');
  eq(parsed.cost, '200');
});

test('fees are left out so the average tracks the executed price', () => {
  // Bought 1000 USDC at 1.0012 with a 0.1% fee charged in the base coin. The fee is ignored, so
  // the average comes back as the price paid (1.0012), not the fee-inclusive 1.0022.
  const parsed = toParsedFill(
    fill({ price: '1.0012', size: '1000', funds: '', fee: '1.0012', feeCurrency: 'USDC' })
  );
  if (!parsed) return fail('expected a parsed fill');
  eq(parsed.qty, '1000');
  eq(parsed.cost, '1001.2');
  eq(averageCost(applyFill(emptyLedger(), parsed)), '1.0012');
});

test('a quote-leg fee does not inflate the cost either', () => {
  const parsed = toParsedFill(fill({ fee: '0.2', feeCurrency: 'USDT' }));
  if (!parsed) return fail('expected a parsed fill');
  eq(parsed.qty, '2');
  eq(parsed.cost, '200');
});

test('a sell charges no cost basis, only removal of size', () => {
  const parsed = toParsedFill(fill({ side: 'sell' }));
  if (!parsed) return fail('expected a parsed fill');
  eq(parsed.side, 'sell');
  eq(parsed.qty, '2');
  eq(parsed.cost, '0');
});

test('a fill with no funds still prices the cost from price times size', () => {
  const parsed = toParsedFill(fill({ funds: '' }));
  if (!parsed) return fail('expected a parsed fill');
  eq(parsed.cost, '200');
});

test('a fill with a non-positive size is dropped', () => {
  eq(toParsedFill(fill({ size: '0' })), null);
});

test('nanosecond timestamps are scaled down to milliseconds', () => {
  eq(normalizeCreatedAt(1_700_000_000_123), 1_700_000_000_123);
  eq(normalizeCreatedAt(1_700_000_000_123_000_000), 1_700_000_000_123);
});

// --- averaging ----------------------------------------------------------------------------------

test('two buys produce the weighted average of their prices', () => {
  const parsed = (price: string, size: string, at: number) =>
    toParsedFill(fill({ price, size, funds: '', createdAt: at }))!;
  const a = parsed('100', '1', 1);
  const b = parsed('200', '3', 2);
  const result = applyFill(applyFill(emptyLedger(), a), b);
  // (100 + 200*3) / 4 = 175
  eq(averageCost(result), '175');
  eq(result.qty, '4');
});

test('a partial sell removes cost in proportion and keeps the average', () => {
  // Buy 4 @ 175, then sell 1. Cost left = 700 * 3/4 = 525, average stays 175.
  const bought = ledger({ qty: '4', cost: '700' });
  const sell = toParsedFill(fill({ side: 'sell', price: '300', size: '1', funds: '300' }))!;
  const result = applyFill(bought, sell);
  eq(result.qty, '3');
  eq(averageCost(result), '175');
});

test('selling the whole position resets quantity and cost', () => {
  const bought = ledger({ qty: '4', cost: '700' });
  const sell = toParsedFill(fill({ side: 'sell', size: '4', price: '300', funds: '1200' }))!;
  const result = applyFill(bought, sell);
  eq(result.qty, '0');
  eq(result.cost, '0');
  eq(averageCost(result), null);
});

test('selling more than held also resets to flat', () => {
  const bought = ledger({ qty: '4', cost: '700' });
  const sell = toParsedFill(fill({ side: 'sell', size: '5', price: '300', funds: '1500' }))!;
  const result = applyFill(bought, sell);
  eq(result.qty, '0');
  eq(result.cost, '0');
});

// --- absorption ---------------------------------------------------------------------------------

test('absorbFills applies a newest-first page in chronological order', () => {
  const page = [
    fill({ tradeId: 'b', price: '200', size: '3', funds: '', createdAt: 2 }),
    fill({ tradeId: 'a', price: '100', size: '1', funds: '', createdAt: 1 }),
  ];
  const result = absorbFills(emptyLedger(), page);
  eq(averageCost(result), '175');
  eq(result.cursor, 2);
  eq(result.cursorIds.join(','), 'b');
});

test('absorbFills skips fills at or before the cursor', () => {
  const start = absorbFills(emptyLedger(), [fill({ tradeId: 'a', createdAt: 5 })]);
  const again = absorbFills(start, [fill({ tradeId: 'a', createdAt: 5 }), fill({ tradeId: 'old', createdAt: 1 })]);
  eq(again.qty, '2');
  eq(again, start);
});

test('absorbFills does not double-count a fill at the cursor timestamp', () => {
  const first = absorbFills(emptyLedger(), [fill({ tradeId: 'a', createdAt: 5 })]);
  const refetched = absorbFills(first, [fill({ tradeId: 'a', createdAt: 5 })]);
  eq(refetched.qty, '2');
});

test('absorbFills counts a new fill sharing the cursor timestamp', () => {
  const first = absorbFills(emptyLedger(), [fill({ tradeId: 'a', createdAt: 5 })]);
  const next = absorbFills(first, [fill({ tradeId: 'b', createdAt: 5 })]);
  eq(next.qty, '4');
  eq(next.cursorIds.sort().join(','), 'a,b');
});

// --- runner -----------------------------------------------------------------------------------

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}: ${(error as Error).message}`);
  }
}

if (failures > 0) throw new Error(`${failures} of ${tests.length} checks failed`);
console.log(`${tests.length} checks passed`);
