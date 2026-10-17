/**
 * Unit tests for the header quote and the position profit/loss derivation.
 *
 * Offline, no network. They pin down the rule the header chip depends on: the market change is
 * measured against the current bucket open and reported as unknown rather than wrong while that
 * open is missing, and the position P&L is only drawn for a real, non-flat holding.
 *
 *   bun src/lib/quote.test.ts
 */
import { derivePositionPnl, deriveQuote } from './quote';

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

// --- deriveQuote -------------------------------------------------------------------------------

test('reports the percentage move from the bucket open', () => {
  const quote = deriveQuote(110, 100)!;
  eq(quote.price, 110);
  eq(quote.change, 10);
  eq(quote.isUp, true);
});

test('reports no change rather than a wrong one while the open is unknown', () => {
  eq(deriveQuote(110, undefined)!.change, null);
  eq(deriveQuote(110, 0)!.change, null);
});

test('keeps the price when the change is unavailable', () => {
  eq(deriveQuote(110, undefined)!.price, 110);
});

test('returns null with no price at all', () => {
  eq(deriveQuote(undefined, 100), null);
});

// --- derivePositionPnl -------------------------------------------------------------------------

test('a position above its average entry is an unrealised profit', () => {
  const pnl = derivePositionPnl(110, '100', '2')!;
  eq(pnl.amount, 20);
  eq(pnl.percent, 10);
  eq(pnl.isUp, true);
});

test('a position below its average entry is an unrealised loss', () => {
  const pnl = derivePositionPnl(90, '100', '2')!;
  eq(pnl.amount, -20);
  eq(pnl.percent, -10);
  eq(pnl.isUp, false);
});

test('a breakeven position reads as up, not down', () => {
  const pnl = derivePositionPnl(100, '100', '1')!;
  eq(pnl.amount, 0);
  eq(pnl.isUp, true);
});

test('follows fractional quantities', () => {
  const pnl = derivePositionPnl(105, '100', '0.5')!;
  eq(pnl.amount, 2.5);
});

test('draws nothing without a known position', () => {
  eq(derivePositionPnl(110, null, '2'), null);
  eq(derivePositionPnl(110, '100', null), null);
  eq(derivePositionPnl(110, '100', '0'), null);
  eq(derivePositionPnl(110, '0', '2'), null);
});

test('draws nothing without a price', () => {
  eq(derivePositionPnl(undefined, '100', '2'), null);
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
