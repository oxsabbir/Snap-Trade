import type { Candle } from './types';

/**
 * The loaded candles and the series identity they belong to, held as one value.
 *
 * Keeping the key beside the array is what makes cross-symbol contamination impossible: the
 * reset on a switch replaces both atomically, and every async write checks the key before
 * merging. A bare array could only be judged by length and timestamps, both of which two
 * bucket-aligned pairs share.
 */
export type CandleSeries = { key: string; candles: Candle[] };

/**
 * Merge a fresh initial or bucket-rollover page into the loaded series.
 *
 * A page for a different pair must replace the series outright, never merge: the outgoing
 * pair's candles can still be loaded when the new key first renders, and folding the incoming
 * page onto them is what made a freshly opened pair show the previous pair's history. When the
 * keys match, already-paged-in older candles are kept and only the recent tail is replaced, so a
 * rollover refetch does not throw away history the user scrolled back through.
 *
 * Pure, so the cross-pair rule is testable without rendering the hook.
 */
export function mergeInitialCandles(
  responseKey: string,
  next: Candle[],
  previous: CandleSeries
): CandleSeries {
  if (previous.key !== responseKey) return { key: responseKey, candles: next };
  if (next.length === 0) return previous;
  const oldest = next[0]!.time;
  const older = previous.candles.filter((candle) => candle.time < oldest);
  const merged = older.length > 0 ? [...older, ...next] : next;
  return { key: responseKey, candles: merged };
}

/**
 * Prepend one older page, dropping any row at or after the current oldest so the boundary
 * candle the API returns inclusively is not doubled. Returns `previous` untouched — the same
 * reference, so React skips the render and, crucially, no other pair's series is disturbed —
 * when the page belongs to a series the user has already left.
 */
export function prependOlderCandles(
  responseKey: string,
  older: Candle[],
  previous: CandleSeries
): CandleSeries {
  if (previous.key !== responseKey) return previous;
  const oldest =
    previous.candles.length > 0
      ? previous.candles[0]!.time
      : Number.POSITIVE_INFINITY;
  const add = older.filter((candle) => candle.time < oldest);
  if (add.length === 0) return previous;
  return { key: responseKey, candles: [...add, ...previous.candles] };
}
