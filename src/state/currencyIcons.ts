import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'kucoin.currencyIcons.v1';
const ICON_MAP_TTL_MS = 10 * 60 * 1000;
const CURRENCIES_URL = 'https://www.kucoin.com/_api/currency/currencies';
const REQUEST_TIMEOUT_MS = 12_000;

type StoredPayload = {
  cachedAt: number;
  icons: Record<string, string>;
};

type RawCurrencyEntry = {
  currency?: unknown;
  iconUrl?: unknown;
};

let iconMap: Record<string, string> = {};
let cachedAt = 0;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let fetchPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function isFresh(): boolean {
  return cachedAt > 0 && Date.now() - cachedAt < ICON_MAP_TTL_MS;
}

async function fetchFromNetwork(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(CURRENCIES_URL, { signal: controller.signal });
      if (!response.ok) return;
      const json = (await response.json()) as { data?: unknown };
      if (!Array.isArray(json?.data)) return;

      const next: Record<string, string> = {};
      for (const item of json.data as RawCurrencyEntry[]) {
        if (
          typeof item?.currency === 'string' &&
          typeof item?.iconUrl === 'string' &&
          item.iconUrl.startsWith('http')
        ) {
          next[item.currency.toUpperCase()] = item.iconUrl;
        }
      }

      if (Object.keys(next).length === 0) return;
      iconMap = next;
      cachedAt = Date.now();
      notify();

      const payload: StoredPayload = { cachedAt, icons: next };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => undefined);
    } catch {
      // Non-blocking: CDN fallbacks and letter-circle handle failures silently.
    } finally {
      clearTimeout(timer);
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

function ensureLoaded(): void {
  if (!hydrated) {
    if (!hydratePromise) {
      hydratePromise = (async () => {
        try {
          const raw = await AsyncStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<StoredPayload>;
            if (
              typeof parsed.cachedAt === 'number' &&
              parsed.icons &&
              typeof parsed.icons === 'object'
            ) {
              iconMap = parsed.icons;
              cachedAt = parsed.cachedAt;
              notify();
            }
          }
        } catch {
          // Ignore corrupt cache and refresh from network.
        } finally {
          hydrated = true;
          hydratePromise = null;
          if (!isFresh()) void fetchFromNetwork();
        }
      })();
    }
    return;
  }

  if (!isFresh()) {
    void fetchFromNetwork();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Returns KuCoin's official `iconUrl` for a currency symbol if loaded, and triggers a
 * non-blocking background refresh whenever the 10-minute cache expires.
 */
export function useCurrencyIconUrl(symbol: string): string | null {
  const key = symbol.toUpperCase();
  const getSnapshot = useCallback(() => iconMap[key] ?? null, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
