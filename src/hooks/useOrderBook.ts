import { useMemo } from 'react';

import { buildDepth, EMPTY_DEPTH, type OrderBookDepth } from '@/lib/kucoin/orderbook';

/**
 * Turns incoming depth messages into the rows the column draws.
 * Level2Socket already bounds snapshot emissions to at most every 150ms.
 * Deriving depth via useMemo computes the depth rows synchronously on each snapshot
 * without any cascading renders or artificial delay timers.
 */
export function useOrderBook(rawMessage: unknown, aggregation: string): OrderBookDepth {
  return useMemo(
    () => (rawMessage ? buildDepth(rawMessage, aggregation) : EMPTY_DEPTH),
    [rawMessage, aggregation]
  );
}
