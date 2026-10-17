/**
 * Unit tests for the compact and signed-dollar formatters the market and P&L chips rely on.
 *
 *   bun src/utils/format.test.ts
 */
import { formatCompact, formatSignedUsd } from './format';

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

test('formatCompact folds trillions as well as billions', () => {
  eq(formatCompact(1_234_000_000_000), '1.23T');
  eq(formatCompact(5_000_000_000), '5.00B');
  eq(formatCompact(2_500_000), '2.50M');
});

test('formatSignedUsd signs a profit and a loss', () => {
  eq(formatSignedUsd(12.34), '+$12.34');
  eq(formatSignedUsd(-0.4), '-$0.4');
  eq(formatSignedUsd(-1234.5), '-$1,234.5');
});

test('formatSignedUsd leaves breakeven unsigned', () => {
  eq(formatSignedUsd(0), '$0');
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
