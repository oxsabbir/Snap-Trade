import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'search:recent';
const MAX_RECENTS = 8;

function normalize(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

export type RecentSearchesState = {
  recents: string[];
  isHydrated: boolean;
  add: (query: string) => void;
  remove: (query: string) => void;
  clear: () => void;
};

export function useRecentSearches(): RecentSearchesState {
  const [recents, setRecents] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          setRecents(parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENTS));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        hydratedRef.current = true;
        setIsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(recents)).catch(() => undefined);
  }, [recents]);

  const add = useCallback((query: string) => {
    const value = normalize(query);
    if (!value) return;
    setRecents((previous) => [value, ...previous.filter((v) => v !== value)].slice(0, MAX_RECENTS));
  }, []);

  const remove = useCallback((query: string) => {
    setRecents((previous) => previous.filter((v) => v !== query));
  }, []);

  const clear = useCallback(() => setRecents([]), []);

  return { recents, isHydrated, add, remove, clear };
}
