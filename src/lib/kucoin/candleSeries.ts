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

/**
 * Fill the buckets KuCoin omitted because nothing traded in them.
 *
 * The endpoint only returns a candle for a bucket that saw a trade, so an illiquid pair comes
 * back as a handful of rows spread across the requested window. Rendered as-is the chart packs
 * those few candles edge to edge and the window collapses — an hour of a quiet coin would be
 * "40 x 1m" next to eight bars. Forward-filling the gaps with flat candles (open = high = low
 * = close = the previous close, no volume) restores one candle per bucket, which is what the
 * axis, the caption and the default window all assume.
 *
 * `target` (with `endMs`) extends the far end to a fixed bucket count — the initial fetch wants
 * a full window even when the newest trade was a while ago — while omitting both fills only the
 * gaps *between* the rows the API returned, so older-history paging never fabricates candles
 * before the pair was listed.
 *
 * Buckets are laid out by stepping a whole interval from a real candle. KuCoin's bucket times
 * are aligned to the interval already, so this keeps the synthetic candles on the same grid as
 * the API and the live socket — even for weekly buckets, whose origin is not the epoch.
 */
export function fillCandleGaps(
  candles: Candle[],
  intervalMs: number,
  options?: { endMs?: number; target?: number }
): Candle[] {
  if (candles.length === 0 || !(intervalMs > 0)) return candles;

  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const end =
    options?.endMs === undefined
      ? last.time
      : Math.max(
          last.time,
          last.time +
            Math.floor((options.endMs - last.time) / intervalMs) * intervalMs
        );
  const start =
    options?.target === undefined
      ? first.time
      : end - Math.max(options.target - 1, 0) * intervalMs;

  const byTime = new Map<number, Candle>();
  for (const candle of candles) byTime.set(candle.time, candle);

  // The value to carry into a gap is the nearest real candle at or before it. Seeding from the
  // latest row at or before `start` is what makes a forward-filled tail (start past the last
  // trade) inherit the last real close rather than the first candle's open.
  let carried = first.open;
  for (const candle of candles) {
    if (candle.time > start) break;
    carried = candle.close;
  }

  const filled: Candle[] = [];
  for (let time = start; time <= end; time += intervalMs) {
    const row = byTime.get(time);
    if (row) {
      filled.push(row);
      carried = row.close;
      continue;
    }
    filled.push({
      time,
      open: carried,
      high: carried,
      low: carried,
      close: carried,
      volume: 0,
      turnover: 0,
    });
  }
  return filled;
}
