/**
 * Unit tests for the candle-series merge rules.
 *
 * Offline, no API key. The paging merge is pure so the one thing that cannot be checked on a
 * rendered hook can be pinned here: a page that belongs to a different pair must never fold
 * into the loaded series. That is what made a freshly opened pair show the previous pair's
 * history — the outgoing candles were still in state when the incoming page resolved.
 *
 *   bun src/lib/kucoin/candleSeries.test.ts
 */
import type { Candle } from '@/lib/kucoin/types';
import {
  fillCandleGaps,
  mergeInitialCandles,
  prependOlderCandles,
  type CandleSeries,
} from '@/lib/kucoin/candleSeries';

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

/** A candle whose close encodes its timestamp, so a wrong merge is visible in the values. */
function candle(time: number): Candle {
  return {
    time,
    open: time,
    high: time,
    low: time,
    close: time,
    volume: 0,
    turnover: 0,
  };
}
function series(key: string, times: number[]): CandleSeries {
  return { key, candles: times.map(candle) };
}
function times(of: CandleSeries): number[] {
  return of.candles.map((c) => c.time);
}

// --- initial / rollover merge -------------------------------------------------------------------

test('a rollover keeps paged-in older candles and replaces only the recent tail', () => {
  const previous = series('BTC-USDT:1min', [10, 20, 30, 40, 50]);
  const next = [40, 50, 60].map(candle);
  const merged = mergeInitialCandles('BTC-USDT:1min', next, previous);
  eq(merged.key, 'BTC-USDT:1min');
  // 10/20/30 are older than the refetched window and survive; 40/50 come from `next`.
  eq(times(merged).join(','), '10,20,30,40,50,60');
});

test('an initial page with no prior history is taken as-is', () => {
  const merged = mergeInitialCandles('SOL-USDT:1min', [40, 50, 60].map(candle), series('SOL-USDT:1min', []));
  eq(times(merged).join(','), '40,50,60');
});

test('a page for a different pair replaces the series instead of merging into it', () => {
  // The regression: BTC was paged back to 5 candles, then SOL is opened and its 3-candle
  // initial page resolves while BTC's candles are still loaded. The result must be SOL's three
  // candles, not BTC's five with SOL's three appended.
  const btc = series('BTC-USDT:1min', [10, 20, 30, 40, 50]);
  const solNext = [40, 50, 60].map(candle);
  const merged = mergeInitialCandles('SOL-USDT:1min', solNext, btc);
  eq(merged.key, 'SOL-USDT:1min');
  eq(merged.candles.length, 3);
  eq(times(merged).join(','), '40,50,60');
});

test('an empty page for the same pair leaves the series untouched', () => {
  const previous = series('BTC-USDT:1min', [10, 20]);
  const merged = mergeInitialCandles('BTC-USDT:1min', [], previous);
  eq(merged, previous);
});

test('an empty page for a different pair still switches to it', () => {
  const merged = mergeInitialCandles('SOL-USDT:1min', [], series('BTC-USDT:1min', [10, 20]));
  eq(merged.key, 'SOL-USDT:1min');
  eq(merged.candles.length, 0);
});

// --- older-page prepend -------------------------------------------------------------------------

test('an older page is prepended in front of the loaded candles', () => {
  const previous = series('BTC-USDT:1min', [40, 50, 60]);
  const older = [-30, -20, -10].map(candle);
  const merged = prependOlderCandles('BTC-USDT:1min', older, previous);
  eq(merged.key, 'BTC-USDT:1min');
  eq(times(merged).join(','), '-30,-20,-10,40,50,60');
});

test('the boundary candle the API returns inclusively is not doubled', () => {
  const previous = series('BTC-USDT:1min', [40, 50, 60]);
  const older = [-20, -10, 40].map(candle);
  const merged = prependOlderCandles('BTC-USDT:1min', older, previous);
  // 40 is already loaded, so only the strictly-older rows are added.
  eq(times(merged).join(','), '-20,-10,40,50,60');
});

test('a page that is not older at all changes nothing', () => {
  const previous = series('BTC-USDT:1min', [40, 50, 60]);
  const merged = prependOlderCandles('BTC-USDT:1min', [70, 80].map(candle), previous);
  eq(merged, previous);
});

test('an older page for a different pair leaves the series untouched', () => {
  const previous = series('SOL-USDT:1min', [40, 50, 60]);
  const merged = prependOlderCandles('BTC-USDT:1min', [-20, -10].map(candle), previous);
  eq(merged, previous);
  eq(times(merged).join(','), '40,50,60');
});

// --- gap filling --------------------------------------------------------------------------------

function bar(time: number, open: number, close: number, volume = 1): Candle {
  return { time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume, turnover: 0 };
}

test('gaps between returned rows are filled flat at the previous close', () => {
  const rows = [
    { time: 0, open: 10, close: 10, high: 10, low: 10, volume: 5, turnover: 0 },
    { time: 3000, open: 20, close: 25, high: 26, low: 19, volume: 9, turnover: 0 },
  ];
  const filled = fillCandleGaps(rows, 1000);
  eq(filled.length, 4);
  eq(
    filled.map((c) => c.time).join(','),
    '0,1000,2000,3000'
  );
  // The two synthetic buckets carry the previous close (10), with no volume.
  eq(filled[1]!.close, 10);
  eq(filled[1]!.open, 10);
  eq(filled[1]!.volume, 0);
  eq(filled[2]!.close, 10);
  // The real rows are untouched.
  eq(filled[3]!.close, 25);
  eq(filled[3]!.volume, 9);
});

test('an empty page stays empty rather than fabricating a price', () => {
  eq(fillCandleGaps([], 1000).length, 0);
});

test('the series ends at the newest row, never extending past it', () => {
  const rows = [bar(0, 5, 6), bar(3000, 18, 20)];
  const filled = fillCandleGaps(rows, 1000);
  eq(filled[filled.length - 1]!.time, 3000);
});



let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
  } catch (caught) {
    failures += 1;
    console.error(`not ok - ${name}: ${(caught as Error).message}`);
  }
}
if (failures > 0) fail(`${failures} of ${tests.length} checks failed`);
console.log(`${tests.length} checks passed`);
