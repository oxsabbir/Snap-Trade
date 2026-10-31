/**
 * Account-value history behind the account tab's PnL card.
 *
 * KuCoin exposes no account-level PnL endpoint for spot, but the app already computes the
 * portfolio's USD total from balances + live prices. That total is snapshotted here whenever an
 * account refresh lands, and the PnL card reports how the value moved since a window started
 * (Today / Week / Month / All) — with deposits and withdrawals corrected over by
 * `src/lib/kucoin/pnl.ts`, so funding the account does not read as profit.
 *
 * Snapshots accumulate only from app usage forward: a window whose start predates the earliest
 * stored snapshot falls back to the first snapshot it can see.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "spot.portfolioHistory.v1";

/** Two snapshots closer than this are collapsed into one (the newer reading wins). */
const MIN_SNAPSHOT_GAP_MS = 5 * 60_000;
/** ~30 days of 5-minute granularity; older entries fall off the ring. */
const MAX_ENTRIES = 600;

export type PortfolioSnapshot = { t: number; v: number };

let state: readonly PortfolioSnapshot[] = [];
const listeners = new Set<() => void>();
/** Bumped on every write, so a load already in flight cannot overwrite newer input. */
let writeCount = 0;
let loadStarted = false;

function emit(next: readonly PortfolioSnapshot[]): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function getPortfolioHistory(): readonly PortfolioSnapshot[] {
  return state;
}

export function subscribePortfolioHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ensurePortfolioHistoryLoaded(): void {
  if (loadStarted) return;
  loadStarted = true;
  const writesBefore = writeCount;
  void (async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const list = parsed
      .filter((entry): entry is { t: number; v: number } => {
        const e = entry as { t?: unknown; v?: unknown };
        return (
          typeof e?.t === "number" &&
          Number.isFinite(e.t) &&
          typeof e?.v === "number" &&
          Number.isFinite(e.v)
        );
      })
      .sort((a, b) => a.t - b.t);
    // Writes made while the read ran are already in `state` and already on disk, so the older
    // disk copy must not replace them.
    if (writeCount !== writesBefore) return;
    emit(list);
  })().catch(() => undefined);
}

/** Keeps the newest reading within the gap so a burst of refreshes does not flood the ring. */
export function recordPortfolioSnapshot(total: number): void {
  if (!Number.isFinite(total) || total < 0) return;
  const now = Date.now();
  const last = state[state.length - 1];
  writeCount += 1;
  if (last && now - last.t < MIN_SNAPSHOT_GAP_MS) {
    emit([...state.slice(0, -1), { t: now, v: total }]);
  } else {
    const next: PortfolioSnapshot[] = [...state, { t: now, v: total }];
    if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
    emit(next);
  }
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(
    () => undefined,
  );
}

/** Last snapshot taken at or before the given time — the PnL window's baseline. */
export function snapshotBefore(time: number): PortfolioSnapshot | null {
  let match: PortfolioSnapshot | null = null;
  for (const entry of state) {
    if (entry.t <= time) match = entry;
    else break;
  }
  return match;
}

/** First snapshot taken at or after the given time, for windows with no earlier history. */
export function snapshotAfter(time: number): PortfolioSnapshot | null {
  for (const entry of state) {
    if (entry.t >= time) return entry;
  }
  return null;
}

export function earliestSnapshot(): PortfolioSnapshot | null {
  return state[0] ?? null;
}
