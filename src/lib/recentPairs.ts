/**
 * The rules behind the Search History list, kept free of React and AsyncStorage so they can be
 * checked directly. Every recent pair is stored as KuCoin's own `BASE-QUOTE` symbol; the slash
 * form (`BTC/USDT`) is presentation only and happens in the card layer.
 */
export const MAX_RECENT_PAIRS = 12;

/** Case and whitespace are the only things that vary between two spellings of the same pair. */
export function normalizePair(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Returns the list with `value` moved to the front: no duplicates, and the untouched entries keep
 * their previous relative order. Existing entries are normalized before comparison so a
 * lower-cased legacy row cannot survive next to its upper-cased twin.
 */
export function recordPair(
  list: readonly string[],
  value: string,
  max: number = MAX_RECENT_PAIRS,
): string[] {
  const target = normalizePair(value);
  if (!target) return [...list];
  return [target, ...list.filter((entry) => normalizePair(entry) !== target)].slice(0, max);
}

/** Drops one pair regardless of how it was stored. */
export function removePair(list: readonly string[], value: string): string[] {
  const target = normalizePair(value);
  if (!target) return [...list];
  return list.filter((entry) => normalizePair(entry) !== target);
}

/** Rebuilds the list from persisted JSON, dropping anything that is not a usable string pair. */
export function parseStoredPairs(raw: unknown, max: number = MAX_RECENT_PAIRS): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const normalized = normalizePair(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, max);
}
