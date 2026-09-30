import { useEffect, useSyncExternalStore } from 'react';

import {
  getPrivateFeedStatus,
  subscribePrivateFeed,
  subscribePrivateFeedStatus,
  type PrivateFeedStatus,
} from '@/state/privateFeed';

const NO_OP = () => {};

/**
 * Keeps the private account feed connected for as long as the app is mounted.
 *
 * Mounted once from the root layout rather than from the trade screen: the feed is account-wide, so
 * a desktop order that happens while the user is on the assets tab still has to land, and a
 * per-screen subscription would close the socket every time they navigated away.
 *
 * The order and balance stores are written directly by the feed, so the status returned here is
 * only needed by anything that wants to show connection state.
 */
export function usePrivateFeed(): { status: PrivateFeedStatus } {
  const status = useSyncExternalStore(
    subscribePrivateFeedStatus,
    getPrivateFeedStatus,
    getPrivateFeedStatus
  );

  useEffect(
    () => subscribePrivateFeed({ onOrder: NO_OP, onBalance: NO_OP, onStatus: NO_OP }),
    []
  );

  return { status };
}
