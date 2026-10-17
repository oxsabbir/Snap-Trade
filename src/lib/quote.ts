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

/**
 * Unrealised profit or loss on the position in the pair being viewed, in the quote currency.
 *
 * The average entry and the net quantity come from the persisted cost-basis ledger, so this works
 * across sessions. Both are decimal strings and may be absent while that ledger loads, in which
 * case there is nothing to show; a flat or unparseable position yields `null` rather than a `$0.00`
 * that would look like a real breakeven.
 */
export type PositionPnl = {
  /** Signed quote-currency profit (+) or loss (-). */
  amount: number;
  /** Return on the entry price, as a percentage, or `null` when it cannot be computed. */
  percent: number | null;
  isUp: boolean;
};

export function derivePositionPnl(
  price: number | undefined,
  avgCost: string | null,
  qty: string | null
): PositionPnl | null {
  if (price === undefined || !Number.isFinite(price)) return null;
  if (avgCost === null || qty === null) return null;
  const entry = Number(avgCost);
  const size = Number(qty);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(size) || size <= 0) return null;

  const amount = (price - entry) * size;
  const percent = ((price - entry) / entry) * 100;
  return { amount, percent: Number.isFinite(percent) ? percent : null, isUp: amount >= 0 };
}
