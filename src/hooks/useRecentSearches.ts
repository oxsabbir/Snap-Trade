import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { MAX_RECENT_PAIRS, parseStoredPairs, recordPair, removePair } from '@/lib/recentPairs';

const STORAGE_KEY = 'search:recent';

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
        setRecents(parseStoredPairs(parsed, MAX_RECENT_PAIRS));
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
    setRecents((previous) => recordPair(previous, query, MAX_RECENT_PAIRS));
  }, []);

  const remove = useCallback((query: string) => {
    setRecents((previous) => removePair(previous, query));
  }, []);

  const clear = useCallback(() => setRecents([]), []);

  return { recents, isHydrated, add, remove, clear };
}
