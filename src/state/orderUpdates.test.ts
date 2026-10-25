/**
 * Unit tests for the open-order frame parsing and merge rules.
 *
 * These run entirely offline — no API key, no socket, no REST — and exist to pin down the two
 * regressions that made the open-orders card disagree with the exchange:
 *
 *   1. a sparse `received` frame resetting a known partial fill back to `0 / size`, and
 *   2. a finished order never retiring because its status was overwritten by a later frame.
 *
 * They use a tiny local harness rather than a test framework so the file typechecks under the app's
 * `tsc` config without pulling in a runner's ambient types. Run it with:
 *
 *   bun src/state/orderUpdates.test.ts
 */
import {
  isTerminalStatus,
  mergeOrderUpdate,
  mergeRestSnapshot,
  normalizeOrder,
  resolveStatus,
  type OpenOrder,
} from './orderUpdates';

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
function ok(value: unknown, message: string): void {
  if (!value) fail(message);
}
function parsed(raw: Record<string, unknown>, wallet?: 'trade' | 'trade_hf'): OpenOrder {
  const order = normalizeOrder(raw, wallet);
  if (!order) fail('expected normalizeOrder to return an order, got null');
  return order;
}

function order(overrides: Partial<OpenOrder> = {}): OpenOrder {
  return {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'limit',
    price: '60000',
    size: '100',
    filledSize: '40',
    status: 'partially_filled',
    wallet: 'trade',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

// --- normalizeOrder ---------------------------------------------------------------------------

test('normalizeOrder reads the classic REST active shape using dealSize', () => {
  const result = parsed({
    id: 'r1',
    symbol: 'ETH-USDT',
    side: 'buy',
    type: 'limit',
    price: '3000',
    size: '2',
    dealSize: '0.5',
    isActive: true,
  });

  eq(result.orderId, 'r1');
  eq(result.filledSize, '0.5');
  eq(result.status, 'partially_filled');
});

test('normalizeOrder treats a fully dealt inactive REST order as filled', () => {
  const result = parsed({
    id: 'r2',
    symbol: 'ETH-USDT',
    side: 'sell',
    type: 'limit',
    price: '3000',
    size: '2',
    dealSize: '2',
    isActive: false,
  });

  eq(result.status, 'filled');
  eq(result.type, 'limit');
});

test('normalizeOrder honours the HF string active flag and keeps the HF wallet', () => {
  const result = parsed(
    {
      id: 'h1',
      symbol: 'BTC-USDT',
      side: 'buy',
      type: 'limit',
      price: '1',
      size: '5',
      dealSize: '1',
      active: 'true',
    },
    'trade_hf'
  );

  eq(result.status, 'partially_filled');
  eq(result.wallet, 'trade_hf');
});

test('normalizeOrder never mistakes the message kind for the order type', () => {
  const result = parsed({
    orderId: 'w1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    orderType: 'limit',
    size: '10',
    filledSize: '3',
    status: 'match',
  });

  eq(result.type, 'limit');
});

test('normalizeOrder returns null for a frame with no order id', () => {
  eq(normalizeOrder({ symbol: 'BTC-USDT', size: '1' }), null);
});

// --- resolveStatus ----------------------------------------------------------------------------

test('resolveStatus trusts the numbers: fully dealt is filled even when the status says open', () => {
  eq(resolveStatus({ type: 'open', status: 'open' }, '100', '100'), 'filled');
});

test('resolveStatus reads update + done with size outstanding as a cancellation', () => {
  eq(resolveStatus({ type: 'update', status: 'done' }, '100', '30'), 'cancelled');
});

test('resolveStatus reads done with everything dealt as a fill', () => {
  eq(resolveStatus({ type: 'update', status: 'done' }, '100', '100'), 'filled');
});

test('resolveStatus reads a match with size outstanding as a partial fill', () => {
  eq(resolveStatus({ type: 'match', status: 'match' }, '100', '10'), 'partially_filled');
});

// --- mergeOrderUpdate -------------------------------------------------------------------------

test('a sparse received frame never resets a known partial fill', () => {
  const { order: merged, filledChanged } = mergeOrderUpdate(order(), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'received',
    status: 'new',
  });

  eq(merged.filledSize, '40');
  eq(merged.size, '100');
  eq(merged.status, 'partially_filled');
  eq(filledChanged, false);
});

test('a match frame advances the fill', () => {
  const { order: merged, filledChanged } = mergeOrderUpdate(order(), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    status: 'match',
    filledSize: '70',
    size: '100',
  });

  eq(merged.filledSize, '70');
  eq(merged.status, 'partially_filled');
  eq(filledChanged, true);
});

test('a stale lower fill cannot move the row backwards', () => {
  const { order: merged, filledChanged } = mergeOrderUpdate(order({ filledSize: '70' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    status: 'match',
    filledSize: '50',
    size: '100',
  });

  eq(merged.filledSize, '70');
  eq(filledChanged, false);
});

test('a filled frame retires the row as filled', () => {
  const { order: merged } = mergeOrderUpdate(order({ filledSize: '70' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'filled',
    status: 'done',
    filledSize: '100',
    size: '100',
  });

  eq(merged.status, 'filled');
  eq(merged.filledSize, '100');
  ok(isTerminalStatus(merged.status), 'filled must be terminal');
});

test('a match frame with remainSize 0 retires as filled immediately', () => {
  const { order: merged } = mergeOrderUpdate(order({ status: 'open', filledSize: '0', size: '100' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    status: 'match',
    size: '100',
    remainSize: '0',
    fillSize: '100',
  });

  eq(merged.status, 'filled');
  eq(merged.filledSize, '100');
  ok(isTerminalStatus(merged.status), 'match with remainSize 0 must be terminal');
});

test('a match frame with remainSize 0 completes a partially filled order immediately', () => {
  const { order: merged } = mergeOrderUpdate(order({ status: 'partially_filled', filledSize: '40', size: '100' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    status: 'match',
    remainSize: '0',
    fillSize: '60',
  });

  eq(merged.status, 'filled');
  eq(merged.filledSize, '100');
  ok(isTerminalStatus(merged.status), 'completing match must be terminal');
});

test('a match frame with partial remainSize updates filledSize and status', () => {
  const { order: merged } = mergeOrderUpdate(order({ status: 'open', filledSize: '0', size: '100' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    status: 'match',
    size: '100',
    remainSize: '30',
  });

  eq(merged.status, 'partially_filled');
  eq(merged.filledSize, '70');
  eq(isTerminalStatus(merged.status), false);
});

test('a canceled frame with remainSize 0 and canceledSize retires as cancelled', () => {
  const { order: merged } = mergeOrderUpdate(order({ filledSize: '40', size: '100' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'canceled',
    status: 'done',
    remainSize: '0',
    canceledSize: '60',
    filledSize: '40',
    size: '100',
  });

  eq(merged.status, 'cancelled');
  ok(isTerminalStatus(merged.status), 'cancelled with size cancelled must be terminal');
});

test('a canceled frame with size outstanding retires as cancelled', () => {
  const { order: merged } = mergeOrderUpdate(order({ filledSize: '40' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'canceled',
    status: 'done',
    filledSize: '40',
    size: '100',
  });

  eq(merged.status, 'cancelled');
  ok(isTerminalStatus(merged.status), 'cancelled must be terminal');
});

test('a terminal row is final and is not resurrected by a later frame', () => {
  const { order: merged } = mergeOrderUpdate(
    order({ status: 'filled', filledSize: '100', size: '100' }),
    {
      orderId: 'o1',
      symbol: 'BTC-USDT',
      side: 'buy',
      type: 'open',
      status: 'open',
      filledSize: '100',
      size: '100',
    }
  );

  eq(merged.status, 'filled');
});

test('an update that omits size keeps the known size and applies the fill', () => {
  const { order: merged } = mergeOrderUpdate(order({ size: '100', filledSize: '10' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'update',
    status: 'open',
    filledSize: '25',
  });

  eq(merged.size, '100');
  eq(merged.filledSize, '25');
  eq(merged.status, 'partially_filled');
});

test('the message kind never overwrites the stored order type', () => {
  const { order: merged } = mergeOrderUpdate(order({ type: 'limit' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    status: 'match',
    filledSize: '50',
    size: '100',
  });

  eq(merged.type, 'limit');
});

test('the wallet is never changed by a feed frame', () => {
  const { order: merged } = mergeOrderUpdate(order({ wallet: 'trade_hf' }), {
    orderId: 'o1',
    symbol: 'BTC-USDT',
    side: 'buy',
    type: 'match',
    status: 'match',
    filledSize: '50',
    size: '100',
  });

  eq(merged.wallet, 'trade_hf');
});

// --- mergeRestSnapshot ------------------------------------------------------------------------

test('a REST snapshot cannot roll a newer WebSocket fill backwards', () => {
  const merged = mergeRestSnapshot(
    order({ filledSize: '70', status: 'partially_filled' }),
    order({ filledSize: '30', status: 'partially_filled' })
  );

  eq(merged.filledSize, '70');
  eq(merged.size, '100');
  eq(merged.status, 'partially_filled');
});

test('a REST snapshot does not resurrect a terminal row as active', () => {
  const merged = mergeRestSnapshot(
    order({ status: 'filled', filledSize: '100', size: '100' }),
    order({ status: 'open', filledSize: '100', size: '100' })
  );

  eq(merged.status, 'filled');
});

test('a REST snapshot that omits size keeps the known size', () => {
  const merged = mergeRestSnapshot(
    order({ size: '100', filledSize: '10' }),
    order({ size: '0', filledSize: '10' })
  );

  eq(merged.size, '100');
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
