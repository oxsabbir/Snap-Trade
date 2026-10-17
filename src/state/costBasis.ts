import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchFills } from '@/lib/kucoin/fills';
import {
  absorbFills,
  averageCost,
  emptyLedger,
  type CostLedger,
} from './costBasisEntries';

/**
 * Per-pair average-cost store.
 *
 * The Assets tab only needs the pair's own base and USDT, and KuCoin can only list fills for one
 * symbol at a time, so the ledger is keyed by the pair. Each pair's ledger is persisted under its
 * own AsyncStorage key so a revisit after a cold start shows the last known average immediately
 * while a background refresh brings it up to date. Nothing here blocks a first paint: the panel
 * subscribes to a view and `ensureCostBasis` fills it in when the request lands.
 */

const KEY_PREFIX = 'cost_basis:';
/** Ignore a refresh that ran less than this long ago so reopening a pair is free. */
const REFRESH_AFTER_MS = 60_000;
const MAX_PAGES = 50;

export type CostBasisView = {
  /** Weighted average cost in quote, or `null` while unknown or flat. */
  avgCost: string | null;
  /** Net base quantity the ledger accounts for, or `null` while unknown. */
  qty: string | null;
  loading: boolean;
  error: string | null;
};

const EMPTY_VIEW: CostBasisView = { avgCost: null, qty: null, loading: false, error: null };

const ledgers = new Map<string, CostLedger>();
const views = new Map<string, CostBasisView>();
const listeners = new Map<string, Set<() => void>>();
const fetchedAt = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

function notify(symbol: string): void {
  const set = listeners.get(symbol);
  if (!set) return;
  for (const listener of set) listener();
}

function setView(symbol: string, view: CostBasisView): void {
  views.set(symbol, view);
  notify(symbol);
}

/**
 * Stable snapshot for `useSyncExternalStore`: the same object is returned until the view actually
 * changes, so a re-render only happens when there is something new to draw.
 */
export function costBasisSnapshot(symbol: string): CostBasisView {
  return views.get(symbol) ?? EMPTY_VIEW;
}

export function subscribeCostBasis(symbol: string, listener: () => void): () => void {
  let set = listeners.get(symbol);
  if (!set) {
    set = new Set();
    listeners.set(symbol, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(symbol);
  };
}

function storageKey(symbol: string): string {
  return `${KEY_PREFIX}${symbol}`;
}

function split(symbol: string): { base: string; quote: string } {
  const dash = symbol.indexOf('-');
  if (dash === -1) return { base: symbol, quote: '' };
  return { base: symbol.slice(0, dash), quote: symbol.slice(dash + 1) };
}

async function loadPersisted(symbol: string): Promise<CostLedger | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(symbol));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CostLedger>;
    return {
      qty: typeof parsed.qty === 'string' ? parsed.qty : '0',
      cost: typeof parsed.cost === 'string' ? parsed.cost : '0',
      cursor: typeof parsed.cursor === 'number' ? parsed.cursor : 0,
      cursorIds: Array.isArray(parsed.cursorIds) ? parsed.cursorIds : [],
    };
  } catch {
    return null;
  }
}

async function persist(symbol: string, ledger: CostLedger): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(symbol), JSON.stringify(ledger));
  } catch {
    // A failed write only costs a refetch next launch; never surface it in the UI.
  }
}

function publish(symbol: string, ledger: CostLedger, loading: boolean, error: string | null): void {
  setView(symbol, {
    avgCost: averageCost(ledger),
    qty: ledger.qty,
    loading,
    error,
  });
}

/**
 * Ensures a ledger for `symbol` exists in memory, pulls any persisted copy on first call, and —
 * unless a refresh ran moments ago — pulls new fills in the background. Safe to call from every
 * mount: concurrent calls share one promise, and a pair with a warm ledger resolves immediately
 * while the refresh continues unawaited by the UI.
 */
export function ensureCostBasis(symbol: string): Promise<void> {
  const active = inflight.get(symbol);
  if (active) return active;

  const symbolParts = split(symbol);

  const task = (async () => {
    let ledger = ledgers.get(symbol) ?? null;
    if (!ledger) {
      ledger = (await loadPersisted(symbol)) ?? emptyLedger();
      ledgers.set(symbol, ledger);
      publish(symbol, ledger, true, null);
    }

    const last = fetchedAt.get(symbol) ?? 0;
    if (Date.now() - last < REFRESH_AFTER_MS) {
      publish(symbol, ledger, false, null);
      return;
    }

    try {
      let page = 1;
      let accumulated: CostLedger = ledger;
      // A cold ledger has no cursor, so a full history is walked. A warm one resumes at the last
      // fill time and normally resolves in a single page.
      const startAt = ledger.cursor > 0 ? ledger.cursor : undefined;

      for (let guard = 0; guard < MAX_PAGES; guard += 1) {
        const result = await fetchFills(symbol, { page, startAt });
        accumulated = absorbFills(accumulated, result.items, symbolParts.base, symbolParts.quote);
        if (!result.hasMore) break;
        page += 1;
      }

      ledgers.set(symbol, accumulated);
      fetchedAt.set(symbol, Date.now());
      await persist(symbol, accumulated);
      publish(symbol, accumulated, false, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load fills';
      publish(symbol, ledgers.get(symbol) ?? emptyLedger(), false, message);
    }
  })();

  inflight.set(symbol, task);
  task.catch(() => {}).finally(() => inflight.delete(symbol));
  return task;
}
