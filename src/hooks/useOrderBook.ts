import { useMemo } from 'react';

import {
  buildDepth,
  EMPTY_DEPTH,
  VISIBLE_LEVELS,
  type OrderBookDepth,
} from '@/lib/kucoin/orderbook';

/**
 * Turns incoming depth messages into the rows the column draws.
 * Level2Socket already bounds snapshot emissions to at most every 150ms.
 * Deriving depth via useMemo computes the depth rows synchronously on each snapshot
 * without any cascading renders or artificial delay timers.
 *
 * `maxLevels` is how many levels per side survive the trim. The split view keeps the default
 * handful that fits beside the form; a single-sided view has the whole column to itself and asks
 * for roughly twice as many.
 */
export function useOrderBook(
  rawMessage: unknown,
  aggregation: string,
  maxLevels: number = VISIBLE_LEVELS,
): OrderBookDepth {
  return useMemo(
    () => (rawMessage ? buildDepth(rawMessage, aggregation, maxLevels) : EMPTY_DEPTH),
    [rawMessage, aggregation, maxLevels]
  );
}
