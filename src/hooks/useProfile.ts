import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'profile:display-name';
const DEFAULT_NAME = 'My KuCoin';
const MAX_LENGTH = 24;

export type ProfileState = {
  displayName: string;
  setDisplayName: (value: string) => void;
};

/**
 * KuCoin's API has no username, so the account card cannot show a real one. This
 * is a local, device-only label — it is never sent anywhere, and it is only ever
 * as identifying as the user chooses to make it.
 */
export function useProfile(): ProfileState {
  const [displayName, setName] = useState(DEFAULT_NAME);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        const trimmed = raw?.trim();
        if (trimmed) setName(trimmed.slice(0, MAX_LENGTH));
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setDisplayName = useCallback((value: string) => {
    // Collapse whitespace so a stray newline cannot break the card layout.
    const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    const next = cleaned || DEFAULT_NAME;
    setName(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  return { displayName, setDisplayName };
}
