import { useCallback } from 'react';

import { snapLog } from '@/lib/snapLog';
import { useSetActiveCoin } from '@/state/activeCoin';
import { prefetchTicker } from '@/state/ticker';

/** The native service dedupes within the same window; this covers a re-delivered deep link. */
const DEDUPE_WINDOW_MS = 10_000;

const lastLaunchBySymbol = new Map<string, number>();

/**
 * Handles a resolved signal: records the coin as active, warms its ticker socket and logs the
 * stage so a `logcat -s SnapTrade` trace shows the whole path from notification to screen.
 *
 * Returns a stable callback so the route can call it from an effect keyed on the symbol.
 */
export function useSignalLaunch(): (symbol: string, source: string) => void {
  const setActiveCoin = useSetActiveCoin();

  return useCallback(
    (symbol: string, source: string) => {
      const now = Date.now();
      const previous = lastLaunchBySymbol.get(symbol);
      if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
        snapLog('Decision', `ignored (dedupe ${symbol} within ${DEDUPE_WINDOW_MS}ms)`);
        return;
      }
      lastLaunchBySymbol.set(symbol, now);

      snapLog('RouteResolved', `${symbol} via ${source}`);

      const base = symbol.split('-')[0] ?? symbol;
      setActiveCoin({ symbol, name: base, decimals: 8 });
      prefetchTicker(symbol);
    },
    [setActiveCoin]
  );
}
