import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { darkColors, lightColors, type ThemeColors } from './index';

/** What the user picked in settings. `system` follows the phone live. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** The resolved scheme actually rendered. */
export type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = 'theme:preference';

type ThemeContextValue = {
  scheme: ColorScheme;
  colors: ThemeColors;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Owns the resolved colour scheme. The first frame renders with the system scheme and the saved
 * override is applied a tick later, so the splash is never held open waiting on storage and a
 * System user sees no flash. `useColorScheme` stays subscribed, so switching the phone theme
 * while System is selected updates the UI without a restart.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !isPreference(raw)) return;
        setPreferenceState(raw);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  // Memoized on the resolved scheme, not on every render, so consumers only re-render on a real
  // theme change — never on price ticks inside children.
  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      colors: scheme === 'light' ? lightColors : darkColors,
      preference,
      setPreference,
    }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
