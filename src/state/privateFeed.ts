/**
 * Owns the private KuCoin WebSocket for the whole app.
 *
 * `/spotMarket/tradeOrdersV2` and `/account/balance` both report the entire account, not one
 * symbol, so there is one socket no matter how many screens read from it. Keeping it here rather
 * than inside a component is what stops the feed from tearing down every time the trade screen
 * unmounts — otherwise an order cancelled on the desktop while the user is on the assets tab would
 * be missed, and the balance would look wrong until they happened to visit trading again.
 *
 * The socket is started lazily, and only when an API key is actually present: signed-out browsing
 * has to keep working, and a reconnect loop against a private endpoint can never succeed without
 * credentials.
 */
import { AppState, type AppStateStatus } from 'react-native';

import {
  PrivateSocket,
  invalidatePrivateBullet,
  type PrivateBalanceMessage,
  type PrivateOrderMessage,
  type PrivateSocketStatus,
} from '@/lib/kucoin/privateSocket';
import { applyBalanceEvent, refreshBalance } from '@/state/balance';
import { applyOrderUpdate, loadOpenOrders } from '@/state/openOrders';

export type PrivateFeedStatus = PrivateSocketStatus;

type Subscriber = {
  onOrder: (message: PrivateOrderMessage) => void;
  onBalance: (message: PrivateBalanceMessage) => void;
  onStatus: (status: PrivateFeedStatus) => void;
};

let socket: PrivateSocket | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let subscriberCount = 0;
let status: PrivateFeedStatus = 'offline';
let started = false;

/**
 * Resubscribing after a reconnect is the reason this re-reads REST on every `connecting` pass:
 * frames that arrived while the socket was down are gone, and the exchange will not replay them.
 * Without this the app would silently disagree with the exchange for as long as it stayed open.
 */
const subscribers = new Set<Subscriber>();
/** Separate from `subscribers` because these only want a status tick, not the frames themselves. */
const statusListeners = new Set<() => void>();

function notifyStatus(next: PrivateFeedStatus): void {
  for (const listener of [...statusListeners]) listener();
}

function onStatus(next: PrivateFeedStatus): void {
  if (next === status) return;
  const wasDown = status !== 'live';
  status = next;
  if ((wasDown && next === 'connecting') || next === 'live') {
    // Frames sent while the socket was down are never replayed, so the REST list is re-read to
    // re-establish the baseline instead of drifting from the exchange for as long as it stays open.
    refreshBalance();
    void loadOpenOrders();
  }
  notifyStatus(next);
  for (const subscriber of [...subscribers]) subscriber.onStatus(next);
}

function handleAppState(next: AppStateStatus): void {
  if (next === 'active') {
    // Backgrounded sockets get dropped by the OS, and anything that happened while the app was in
    // the background was missed, so the baseline is re-read on the way back in.
    refreshBalance();
    void loadOpenOrders();
    if (subscriberCount > 0) start();
  } else {
    stop();
  }
}

function start(): void {
  if (started) return;
  started = true;
  socket ??= new PrivateSocket({
    onOrder: (message) => {
      // Applied to the store regardless of who is listening, so a fill or cancellation that
      // happened while no list was mounted is already reflected when one is.
      applyOrderUpdate(message);
      for (const subscriber of [...subscribers]) subscriber.onOrder(message);
    },
    onBalance: (message) => {
      // Applied to the store regardless of who is listening, so a balance frame that arrives with
      // no subscriber mounted is not lost — it is simply already reflected when a screen mounts.
      applyBalanceEvent(message);
      for (const subscriber of [...subscribers]) subscriber.onBalance(message);
    },
    onStatus,
  });
  socket.start();
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', handleAppState);
  }
}

function stop(): void {
  if (!started) return;
  started = false;
  socket?.stop();
  appStateSubscription?.remove();
  appStateSubscription = null;
}

/**
 * Registers a listener and keeps the feed alive for as long as at least one is mounted.
 *
 * The order messages are also written to the shared store here, so subscribing is only needed by
 * callers that want the raw frames.
 */
export function subscribePrivateFeed(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  subscriberCount += 1;
  start();

  return () => {
    subscribers.delete(subscriber);
    subscriberCount -= 1;
    if (subscriberCount > 0) return;
    stop();
  };
}

export function getPrivateFeedStatus(): PrivateFeedStatus {
  return status;
}

export function subscribePrivateFeedStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Drops the current connection and, if anything is still listening, starts a fresh one.
 *
 * Needed when credentials change: a socket opened before the key was saved gave up immediately, and
 * one opened before the key was removed would keep a token the exchange no longer honours. Both
 * need the token cache cleared too, or the reconnect reuses the stale one.
 */
export function restartPrivateFeed(): void {
  stop();
  invalidatePrivateBullet();
  if (subscriberCount > 0) start();
}
