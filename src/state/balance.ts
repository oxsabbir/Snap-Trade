/**
 * The trading-wallet balance behind the order form's "Available" row.
 *
 * This is a store rather than a hook because the balance is needed in three places that cannot see
 * each other — the route, the order form, and anything that changes what the account holds — and a
 * hook gave each of them its own copy and its own request. Cancelling an order updated one copy
 * while the form kept showing another.
 *
 * It also has to be refreshed at the right *moments*, not just on demand. Placing an order freezes
 * funds immediately, but cancelling releases them a beat later, so a refresh fired the instant the
 * cancel returns still reads the pre-cancel figure. `refreshBalanceAfterSettle` re-reads a few
 * times over the next second and a half so the number converges on what the account actually holds
 * rather than on when we happened to ask.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { fetchAccounts } from '@/lib/kucoin/account';
import { describeError } from '@/lib/kucoin/errors';
import { addDecimal } from '@/utils/decimal';

export type BalanceState = {
  /** Free balance per currency in the `trade` wallet, as decimal strings. Absent means zero. */
  available: Record<string, string>;
  /** True only for the first load, when there is nothing to show yet. */
  isLoading: boolean;
  /** True while a refresh runs over an already-populated balance, which must not blank the row. */
  isRefreshing: boolean;
  error: string | null;
};

const EMPTY: Record<string, string> = {};

/**
 * Re-read offsets for a change the exchange applies asynchronously. The first is immediate, the
 * later ones cover the window in which a released or frozen balance settles.
 */
const SETTLE_OFFSETS_MS = [0, 500, 1500];

let state: BalanceState = {
  available: EMPTY,
  isLoading: true,
  isRefreshing: false,
  error: null,
};

const listeners = new Set<() => void>();

let inFlight: Promise<void> | null = null;
/** Set when a refresh is asked for mid-flight, so it is not silently dropped. */
let queued = false;
let settleTimers: ReturnType<typeof setTimeout>[] = [];
let appStateSubscription: { remove: () => void } | null = null;

function emit(patch: Partial<BalanceState>): void {
  state = { ...state, ...patch };
  // Copied so a listener that unsubscribes while being notified cannot skip the next one.
  for (const listener of [...listeners]) listener();
}

export function getBalanceState(): BalanceState {
  return state;
}

export function subscribeBalance(listener: () => void): () => void {
  listeners.add(listener);

  // One foreground listener for the whole app rather than one per component, so mounting a second
  // consumer does not start polling `/accounts` a second time behind the scenes.
  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refreshBalance();
    });
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    appStateSubscription?.remove();
    appStateSubscription = null;
  };
}

function sumAvailable(current: string | undefined, next: string): string {
  if (!current) return next;
  return addDecimal(current, next) ?? next;
}

async function load(): Promise<void> {
  try {
    // The `trade` wallet is the only one `POST /api/v1/orders` debits, so a balance in `main`
    // cannot fund an order and must not be shown as if it could.
    const accounts = await fetchAccounts('trade');
    const next: Record<string, string> = {};
    for (const account of accounts) {
      if (account.type !== 'trade') continue;
      next[account.currency] = sumAvailable(next[account.currency], account.available);
    }
    emit({ available: next, error: null });
  } catch (caught) {
    emit({ error: describeError(caught, 'Failed to load balance.') });
  } finally {
    emit({ isLoading: false, isRefreshing: false });
  }
}

function run(): void {
  if (inFlight) {
    queued = true;
    return;
  }
  inFlight = load().finally(() => {
    inFlight = null;
    if (!queued) return;
    queued = false;
    run();
  });
}

/**
 * Re-reads the balance once. Concurrent callers share one request, and a caller that arrives while
 * one is running is honoured by a trailing re-read rather than dropped.
 */
export function refreshBalance(): void {
  // A refresh over an existing balance must not flip `isLoading`, or the row blanks out under the
  // user every time an order changes.
  emit({ isRefreshing: state.available !== EMPTY });
  run();
}

/**
 * Re-reads the balance over the next second and a half, for changes the exchange applies late.
 *
 * This is what a cancel needs: the funds are released on KuCoin's side after `DELETE /orders/{id}`
 * has already returned, so asking once straight after it reads the balance as it was before the
 * cancel. Asking again a moment later is what makes the number actually move.
 */
export function refreshBalanceAfterSettle(): void {
  for (const timer of settleTimers) clearTimeout(timer);
  settleTimers = SETTLE_OFFSETS_MS.map((delay) =>
    setTimeout(() => {
      refreshBalance();
    }, delay)
  );
}

/** Drops any pending settle re-reads. Used when the screen goes away so they do not fire into a
 *  balance nobody is looking at. */
export function cancelPendingBalanceRefresh(): void {
  for (const timer of settleTimers) clearTimeout(timer);
  settleTimers = [];
}
