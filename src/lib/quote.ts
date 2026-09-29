/**
 * The header quote: a live price, plus change measured against the current bucket's open.
 *
 * These two are not available at the same time. The price comes from the socket and is
 * therefore valid whenever a pair is selected, but the bucket's open only exists once
 * history for the *current* series has landed. Changing timeframe refetches the candles
 * while the socket keeps ticking, so there is a window where the price is known and the
 * open is not. Treating that as "no header" blanks the price out for a fraction of a
 * second on every timeframe change; treating the outgoing bucket's open as current reports
 * a badly wrong percentage, because a 1m open and a 1D open are unrelated numbers.
 *
 * So: always surface the price, and report no change rather than a wrong one.
 */
export type Quote = {
  price: number;
  /** Percent move from the bucket open, or null while that open is unknown. */
  change: number | null;
  isUp: boolean;
};

export function deriveQuote(livePrice: number | undefined, bucketOpen: number | undefined): Quote | null {
  if (livePrice === undefined) return null;
  const change =
    bucketOpen === undefined || bucketOpen === 0 ? null : ((livePrice - bucketOpen) / bucketOpen) * 100;
  return { price: livePrice, change, isUp: (change ?? 0) >= 0 };
}
