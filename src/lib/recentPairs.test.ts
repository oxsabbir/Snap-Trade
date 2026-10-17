/**
 * Unit tests for the Search History list rules.
 *
 * Offline like the other suites — no network, no renderer, no AsyncStorage. They pin down the
 * behaviour the panel promises: newest first, re-opening moves a pair to the front without
 * duplicating it, older entries keep their relative order, and the list is capped.
 *
 *   bun src/lib/recentPairs.test.ts
 */
import { MAX_RECENT_PAIRS, normalizePair, parseStoredPairs, recordPair, removePair } from './recentPairs';

const tests: { name: string; run: () => void }[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

function fail(message: string): never {
  throw new Error(message);
}
function eq(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`expected ${e}, got ${a}`);
}

// --- normalizePair -----------------------------------------------------------------------------

test('upper-cases and trims a pair', () => {
  eq(normalizePair('  btc-usdt '), 'BTC-USDT');
});

test('collapses inner whitespace', () => {
  eq(normalizePair('BTC  / USDT'), 'BTC / USDT');
});

// --- recordPair --------------------------------------------------------------------------------

test('a first pair lands alone at the front', () => {
  eq(recordPair([], 'BTC-USDT'), ['BTC-USDT']);
});

test('the newest pair goes first', () => {
  eq(recordPair(['BTC-USDT'], 'NAVI-USDT'), ['NAVI-USDT', 'BTC-USDT']);
});

test('re-opening a pair moves it to the front', () => {
  eq(recordPair(['BTC-USDT', 'NAVI-USDT'], 'BTC-USDT'), ['BTC-USDT', 'NAVI-USDT']);
});

test('re-opening never creates a duplicate', () => {
  eq(recordPair(['BTC-USDT', 'NAVI-USDT'], 'BTC-USDT'), ['BTC-USDT', 'NAVI-USDT']);
});

test('a re-opened pair keeps the others in their previous order', () => {
  eq(
    recordPair(['BTC-USDT', 'NAVI-USDT', 'ETH-USDT', 'SOL-USDT'], 'ETH-USDT'),
    ['ETH-USDT', 'BTC-USDT', 'NAVI-USDT', 'SOL-USDT'],
  );
});

test('the same pair in a different case is treated as one entry', () => {
  eq(recordPair(['BTC-USDT'], 'btc-usdt'), ['BTC-USDT']);
});

test('a lower-cased legacy row is replaced by its upper-cased twin', () => {
  eq(recordPair(['btc-usdt', 'ETH-USDT'], 'BTC-USDT'), ['BTC-USDT', 'ETH-USDT']);
});

test('the list is capped at the maximum', () => {
  const full = Array.from({ length: MAX_RECENT_PAIRS }, (_, i) => `COIN${i}-USDT`);
  const next = recordPair(full, 'NEW-USDT');
  eq(next.length, MAX_RECENT_PAIRS);
  eq(next[0], 'NEW-USDT');
});

test('a newer pair evicts the oldest one', () => {
  const full = Array.from({ length: MAX_RECENT_PAIRS }, (_, i) => `COIN${i}-USDT`);
  const next = recordPair(full, 'NEW-USDT');
  eq(next[next.length - 1], `COIN${MAX_RECENT_PAIRS - 2}-USDT`);
});

test('an empty or whitespace-only pair leaves the list unchanged', () => {
  eq(recordPair(['BTC-USDT'], '   '), ['BTC-USDT']);
  eq(recordPair(['BTC-USDT'], ''), ['BTC-USDT']);
});

test('an empty list with an empty pair stays empty', () => {
  eq(recordPair([], '  '), []);
});

// --- removePair --------------------------------------------------------------------------------

test('removes one pair and leaves the rest in order', () => {
  eq(removePair(['BTC-USDT', 'NAVI-USDT', 'ETH-USDT'], 'NAVI-USDT'), ['BTC-USDT', 'ETH-USDT']);
});

test('removes a pair stored in a different case', () => {
  eq(removePair(['btc-usdt', 'ETH-USDT'], 'BTC-USDT'), ['ETH-USDT']);
});

test('removing an unknown pair is a no-op', () => {
  eq(removePair(['BTC-USDT'], 'SOL-USDT'), ['BTC-USDT']);
});

// --- parseStoredPairs --------------------------------------------------------------------------

test('normalizes and de-duplicates a restored list', () => {
  eq(parseStoredPairs(['btc-usdt', 'BTC-USDT', 'ETH-USDT']), ['BTC-USDT', 'ETH-USDT']);
});

test('drops entries that are not strings', () => {
  eq(parseStoredPairs(['BTC-USDT', 42, null, { symbol: 'X' }]), ['BTC-USDT']);
});

test('drops empty strings', () => {
  eq(parseStoredPairs(['', '   ', 'BTC-USDT']), ['BTC-USDT']);
});

test('caps a restored list at the maximum', () => {
  const raw = Array.from({ length: 40 }, (_, i) => `COIN${i}-USDT`);
  eq(parseStoredPairs(raw).length, MAX_RECENT_PAIRS);
});

test('returns an empty list for non-array persisted data', () => {
  eq(parseStoredPairs(null), []);
  eq(parseStoredPairs('nope'), []);
  eq(parseStoredPairs({ a: 1 }), []);
  eq(parseStoredPairs(undefined), []);
});

// --- runner ------------------------------------------------------------------------------------

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
