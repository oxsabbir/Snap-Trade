import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';
import { parseTradeSignalUrl } from '@/lib/signalUrl';
import { snapLog } from '@/lib/snapLog';

/**
 * Routes runtime `snaptrade://trade/<symbol>` intents to the trade screen.
 *
 * A cold start is already covered: the launch intent is the activity's initial URL, so Expo
 * Router resolves `/trade/<symbol>` before this ever mounts. This only has to handle the warm
 * case — the activity is alive in the background and `singleTask` re-delivers the intent, which
 * arrives here as a `url` event rather than a new launch.
 *
 * With signal detection stripped from the build the listener is never registered — the flag is
 * a bundle-time literal, so the whole body is dead code the minifier drops.
 */
export function useSignalDeepLink(): void {
  const lastHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!SIGNAL_DETECTION_ENABLED) return;

    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (!url || lastHandledRef.current === url) return;
      const signal = parseTradeSignalUrl(url);
      if (!signal) return;

      lastHandledRef.current = url;
      snapLog('DeepLink', `runtime intent ${signal.symbol}`);

      try {
        router.navigate({
          pathname: '/trade/[symbol]',
          // `entry`/`tp1` are mutually exclusive: gem posts carry a price, TP posts carry TP1.
          params: {
            symbol: signal.symbol,
            ...(signal.entry ? { entry: signal.entry } : {}),
            ...(signal.tp1 ? { tp1: signal.tp1 } : {}),
          },
        });
      } catch {
        // The navigator may not be mounted for a beat on a very early intent; the launch URL
        // path still lands the user on the screen.
      }
    });

    return () => subscription.remove();
  }, []);
}
