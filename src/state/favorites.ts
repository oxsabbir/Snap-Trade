/**
 * The user's pinned spot pairs, shared app-wide and persisted.
 *
 * Favorites are screen-agnostic state rather than component state: they are starred from the
 * markets list and read by its Favorites tab, and the whole point is that they survive the
 * screen unmounting and the app restarting — which component state cannot do. The shape
 * (module store + subscribe + AsyncStorage) mirrors `theme/ThemeProvider` and `state/activeCoin`.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "spot.favorites.v1";

let state: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();
/** Bumped on every toggle, so a load that was already in flight cannot overwrite newer input. */
let writeCount = 0;
let loadStarted = false;

function emit(next: ReadonlySet<string>): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function getFavorites(): ReadonlySet<string> {
  return state;
}

export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the stored list once per app run; toggling before it resolves cannot be rolled back. */
export function ensureFavoritesLoaded(): void {
  if (loadStarted) return;
  loadStarted = true;
  const writesBefore = writeCount;
  void (async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const list = parsed.filter((value): value is string => typeof value === "string");
    // Touches that landed while the read ran are already reflected in `state` — and already
    // written to storage — so the older disk copy must not replace them.
    if (writeCount !== writesBefore) return;
    emit(new Set(list));
  })().catch(() => undefined);
}

/** Flips one symbol's star, updates the in-memory set, and persists the whole list. */
export function toggleFavorite(symbol: string): void {
  const next = new Set(state);
  if (next.has(symbol)) next.delete(symbol);
  else next.add(symbol);
  writeCount += 1;
  emit(next);
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next])).catch(
    () => undefined,
  );
}

export type Favorites = {
  favorites: ReadonlySet<string>;
  toggleFavorite: (symbol: string) => void;
};

/** The store's React binding: re-renders on every star and loads storage on first mount. */
export function useFavorites(): Favorites {
  const favorites = useSyncExternalStore(subscribeFavorites, getFavorites, getFavorites);

  useEffect(() => {
    ensureFavoritesLoaded();
  }, []);

  return useMemo(() => ({ favorites, toggleFavorite }), [favorites]);
}
