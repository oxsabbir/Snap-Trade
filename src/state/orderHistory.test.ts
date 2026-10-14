/**
 * Unit tests for the order-history normalization and ordering rules.
 *
 * Offline like the open-order tests — no API key, no REST. They pin down the cases the tab depends
 * on: a fully dealt order reads as filled, a partially (or never) dealt one reads as cancelled, a
 * cancellation with no fill has no average price to show, and the two books' rows are merged into a
 * single newest-first list without duplicates.
 *
 *   bun src/state/orderHistory.test.ts
 */
import {
  normalizeHistoryOrder,
  sortAndDedupeHistory,
  type OrderHistoryEntry,
} from './orderHistoryEntries';

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
function parsed(raw: Record<string, unknown>, wallet?: 'trade' | 'trade_hf'): OrderHistoryEntry {
  const entry = normalizeHistoryOrder(raw, wallet);
  if (!entry) fail('expected normalizeHistoryOrder to return an entry, got null');
  return entry;
}

// --- status -----------------------------------------------------------------------------------

test('a fully dealt inactive order reads as filled', () => {
  const entry = parsed({
    id: 'c1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'limit',
    price: '60000',
    size: '2',
    dealSize: '2',
    dealFunds: '120000',
    isActive: false,
  });

  eq(entry.status, 'filled');
  eq(entry.wallet, 'trade');
});

test('a partially dealt inactive order reads as cancelled, keeping its dealt size', () => {
  const entry = parsed({
    id: 'c2',
    symbol: 'BTC-USDT',
    side: 'sell',
    type: 'limit',
    price: '60000',
    size: '2',
    dealSize: '0.5',
    dealFunds: '30000',
    isActive: false,
  });

  eq(entry.status, 'cancelled');
  eq(entry.filledSize, '0.5');
});

test('a cancellation with no fill has no average price', () => {
  const entry = parsed({
    id: 'c3',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'limit',
    price: '60000',
    size: '1',
    dealSize: '0',
    dealFunds: '0',
    isActive: false,
  });

  eq(entry.status, 'cancelled');
  eq(entry.avgPrice, null);
});

test('an active row is reported as open rather than history', () => {
  const entry = parsed({
    id: 'c4',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'limit',
    price: '60000',
    size: '1',
    dealSize: '0',
    isActive: true,
  });

  eq(entry.status, 'open');
});

test('the HF string active flag is read and the HF wallet kept', () => {
  const entry = parsed(
    {
      id: 'h1',
      symbol: 'ETH-USDT',
      side: 'buy',
      type: 'limit',
      price: '3000',
      size: '1',
      dealSize: '1',
      dealFunds: '3000',
      active: 'false',
    },
    'trade_hf'
  );

  eq(entry.status, 'filled');
  eq(entry.wallet, 'trade_hf');
});

test('a market order is not mistaken for a limit order', () => {
  const entry = parsed({
    id: 'c5',
    symbol: 'BTC-USDT',
    side: 'sell',
    type: 'market',
    price: '0',
    size: '1',
    dealSize: '1',
    dealFunds: '60000',
    isActive: false,
  });

  eq(entry.type, 'market');
});

// --- average price ----------------------------------------------------------------------------

test('average execution price is dealFunds over dealSize', () => {
  const entry = parsed({
    id: 'c6',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'limit',
    price: '50000',
    size: '2',
    dealSize: '2',
    dealFunds: '100000',
    isActive: false,
  });

  eq(entry.avgPrice, '50000');
});

test('normalizeHistoryOrder returns null for a row with no id', () => {
  eq(normalizeHistoryOrder({ symbol: 'BTC-USDT', size: '1' }), null);
});

// --- sorting and de-duplication ---------------------------------------------------------------

function entry(overrides: Partial<OrderHistoryEntry>): OrderHistoryEntry {
  return {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'limit',
    price: '1',
    size: '1',
    filledSize: '1',
    dealFunds: '1',
    avgPrice: '1',
    status: 'filled',
    wallet: 'trade',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

test('the merged list is newest first', () => {
  const sorted = sortAndDedupeHistory([
    entry({ orderId: 'old', createdAt: 1000 }),
    entry({ orderId: 'new', createdAt: 3000 }),
    entry({ orderId: 'mid', createdAt: 2000 }),
  ]);

  eq(
    sorted.map((e) => e.orderId).join(','),
    'new,mid,old'
  );
});

test('an id appearing in both books is kept once', () => {
  const sorted = sortAndDedupeHistory([
    entry({ orderId: 'dup', createdAt: 1000 }),
    entry({ orderId: 'dup', createdAt: 2000 }),
  ]);

  eq(sorted.length, 1);
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
