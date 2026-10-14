import type { ReactNode } from 'react';

/**
 * Detection and launching now happen entirely in the native `NotificationListener`, so a
 * notification can open the trade screen even when the JS runtime is not running.
 *
 * This used to duplicate that decision in JS and call `router.navigate` itself. That path is
 * gone: the native service already sends the `snaptrade://trade/<symbol>` link, and keeping a
 * second navigator here would race it and push the trade screen twice.
 */
export function NotificationListenerProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
