/**
 * Unit tests for signal-link parsing.
 *
 * Offline, no network and no React Native: the parsing was split into `signalParse.ts` precisely
 * so it can run under plain Bun — importing `signalUrl.ts` pulls `expo-linking` (and thus the RN
 * module graph), which Bun cannot load.
 *
 *   bun src/lib/signalParse.test.ts
 */
import { normalizeTradeSymbol, parseSignalParts, sanitizeDecimal } from './signalParse';

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
function deepEq(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) fail(`expected ${b}, got ${a}`);
}

// --- normalizeTradeSymbol ---------------------------------------------------------------------

test('adds the USDT quote to a bare ticker', () => {
  eq(normalizeTradeSymbol('SKY'), 'SKY-USDT');
});

test('uppercases and keeps an existing pair', () => {
  eq(normalizeTradeSymbol('sky-usdt'), 'SKY-USDT');
});

test('trims surrounding whitespace', () => {
  eq(normalizeTradeSymbol('  sol-usdt  '), 'SOL-USDT');
});

test('rejects a non-pair such as a pair with a slash', () => {
  eq(normalizeTradeSymbol('BTC/USDT'), null);
});

test('rejects empty and missing input', () => {
  eq(normalizeTradeSymbol(''), null);
  eq(normalizeTradeSymbol(null), null);
  eq(normalizeTradeSymbol(undefined), null);
});

// --- sanitizeDecimal --------------------------------------------------------------------------

test('keeps a plain decimal string untouched', () => {
  eq(sanitizeDecimal('0.0034'), '0.0034');
});

test('trims a padded decimal', () => {
  eq(sanitizeDecimal('  0.0007320 '), '0.0007320');
});

test('rejects a leading-dot decimal, a number, and garbage', () => {
  eq(sanitizeDecimal('.0034'), null);
  eq(sanitizeDecimal(42), null);
  eq(sanitizeDecimal('abc'), null);
  eq(sanitizeDecimal('1,2'), null);
});

// --- parseSignalParts -------------------------------------------------------------------------

test('reads TP1 from a trade-host link', () => {
  deepEq(parseSignalParts('trade', 'SKY', { tp1: '0.0034' }), {
    symbol: 'SKY-USDT',
    entry: null,
    tp1: '0.0034',
  });
});

test('reads the gem entry price', () => {
  deepEq(parseSignalParts('trade', 'SKY', { entry: '0.0007306' }), {
    symbol: 'SKY-USDT',
    entry: '0.0007306',
    tp1: null,
  });
});

test('reads both posted prices together', () => {
  deepEq(parseSignalParts('trade', 'SKY', { entry: '1.5', tp1: '2.5' }), {
    symbol: 'SKY-USDT',
    entry: '1.5',
    tp1: '2.5',
  });
});

test('accepts the leading trade-segment shape', () => {
  deepEq(parseSignalParts('', '/trade/sky', {}), {
    symbol: 'SKY-USDT',
    entry: null,
    tp1: null,
  });
});

test('drops a non-decimal posted price', () => {
  deepEq(parseSignalParts('trade', 'SKY', { tp1: 'soon' }), {
    symbol: 'SKY-USDT',
    entry: null,
    tp1: null,
  });
});

test('returns null for a link with no tradeable pair', () => {
  eq(parseSignalParts('trade', 'not a pair', {}), null);
  eq(parseSignalParts('other', 'home', {}), null);
});

test('tolerates missing query params', () => {
  deepEq(parseSignalParts('trade', 'SKY', null), {
    symbol: 'SKY-USDT',
    entry: null,
    tp1: null,
  });
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
