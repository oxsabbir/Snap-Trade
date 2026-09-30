import { useEffect, useRef, useState } from 'react';

import { buildDepth, EMPTY_DEPTH, type OrderBookDepth } from '@/lib/kucoin/orderbook';

/**
 * Recalculation is capped at roughly 6-7 times a second. The socket already merges every diff,
 * so dropping intermediate frames loses nothing but the intermediate renders; without this a
 * busy pair would sort and re-render the book on every diff it pushed.
 */
const THROTTLE_MS = 150;

/**
 * Turns incoming depth messages into the rows the column draws. The message may be the merged
 * snapshot from `Level2Socket` or a raw KuCoin frame; `buildDepth` normalizes either. The
 * expensive sort, cumulative walk and bar widths run on the throttle, while the newest message is
 * only parked in a ref, so a burst of pushes costs one recalculation.
 */
export function useOrderBook(rawMessage: unknown, aggregation: string): OrderBookDepth {
  const [depth, setDepth] = useState<OrderBookDepth>(EMPTY_DEPTH);
  const latestRef = useRef<unknown>(rawMessage);
  const aggregationRef = useRef(aggregation);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestRef.current = rawMessage;
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setDepth(buildDepth(latestRef.current, aggregationRef.current));
    }, THROTTLE_MS);
  }, [rawMessage]);

  // A step change should land immediately rather than wait out the throttle. The rebuild below
  // is the point of the effect: it turns the new step into rows straight from the newest message.
  useEffect(() => {
    aggregationRef.current = aggregation;
    setDepth(buildDepth(latestRef.current, aggregation));
  }, [aggregation]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return depth;
}
