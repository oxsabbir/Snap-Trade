/**
 * The trading-wallet balance behind the order form's "Available" row.
 *
 * This is a store rather than a hook because the balance is needed in three places that cannot see
 * each other — the route, the order form, and anything that changes what the account holds — and a
 * hook gave each of them its own copy and its own request. Cancelling an order updated one copy
 * while the form kept showing another.
 *
 * REST is only the baseline. The private `/account/balance` feed reports the *absolute* available
 * and held amounts for every change — including ones made on the desktop — so `applyBalanceEvent`
 * writes those straight in. `reconcileBalanceAfterChange` then re-reads once as a safety net for
 * the case where the socket was not connected when the change happened.
 */
import { AppState, type AppStateStatus } from 'react-native';

import { fetchAccounts } from '@/lib/kucoin/account';
import { describeError } from '@/lib/kucoin/errors';
import type { PrivateBalanceMessage } from '@/lib/kucoin/privateSocket';
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
 * How long after a known balance-changing event the REST figure is re-read once.
 *
 * The push feed carries the new total, so this is only insurance: if the socket was down, or a
 * change slipped through while the app was backgrounded, the number self-heals instead of sitting
 * stale until the next foreground.
 */
const RECONCILE_DELAY_MS = 1000;

/**
 * The balance books this screen is allowed to display.
 *
 * `/account/balance` reports every book the account has and names the one that moved in
 * `relationEvent` — `trade.hold` and `trade.setted` for the classic spot trade wallet, plus
 * `main.*`, `trade_hf.*`, `margin.*` and `isolated*` for the others. Only the trade wallet can fund
 * a spot limit order, so funds sitting in `main` are not spendable and must not be shown as if
 * they were.
 */
const DISPLAYED_BOOK = 'trade.';

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
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
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
 * Fills the balance the first time something needs it, and does nothing thereafter.
 *
 * This exists because the route and the order form both mount and both need a balance, and they
 * mount at the same time. Two calls to `refreshBalance` there meant two sequential `/accounts`
 * requests: the second one arrived mid-flight, so the trailing re-read the code above implements
 * fired and the app paid for a round trip it already had the answer to. A genuine change still
 * goes through `refreshBalance`, where losing a concurrent call would actually cost a stale number.
 */
export function ensureBalanceLoaded(): void {
  if (state.available !== EMPTY || inFlight) return;
  run();
}

/**
 * Applies one `/account/balance` frame.
 *
 * The push carries absolute amounts rather than deltas, so there is nothing to add — the value it
 * reports *is* the new balance. Overwriting rather than accumulating is what makes this immune to
 * the duplicate frames and reconnect replays a push feed can send.
 */
export function applyBalanceEvent(message: PrivateBalanceMessage): void {
  const book = message.relationEvent;
  // No relationEvent means the exchange did not say which wallet moved, so the number cannot be
  // attributed to the one this screen shows. Ignoring it is safer than showing main funds as
  // trade funds.
  if (typeof book !== 'string' || !book.startsWith(DISPLAYED_BOOK)) return;

  const currency = typeof message.currency === 'string' ? message.currency : '';
  const available = typeof message.available === 'string' ? message.available : '';
  if (!currency || !available || !Number.isFinite(Number(available))) return;

  emit({
    available: { ...state.available, [currency]: available },
    error: null,
  });
}

/**
 * Re-reads the balance once a moment after a known change.
 *
 * The push feed normally makes this redundant — it arrives before or with the REST view of the
 * same change — but it is what keeps the number honest when the socket was not connected at the
 * time. Kept as a single delayed re-read rather than the old 0/500/1500ms ladder, because the
 * ladder existed to catch a settle that is now reported directly.
 */
export function reconcileBalanceAfterChange(): void {
  if (reconcileTimer) clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    refreshBalance();
  }, RECONCILE_DELAY_MS);
}

/** Drops a pending reconcile so it cannot fire into a screen nobody is looking at. */
export function cancelPendingBalanceRefresh(): void {
  if (!reconcileTimer) return;
  clearTimeout(reconcileTimer);
  reconcileTimer = null;
}
