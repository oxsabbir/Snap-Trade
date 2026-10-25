import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';

const STORAGE_KEY_ENABLED = 'signal_detection_enabled';
const STORAGE_KEY_DISPLAY_NAME = 'signal_source:display-name';
const DEFAULT_DISPLAY_NAME = 'Trader';

/** Wide enough for several comma-separated sources ("Alpha Calls, Gem Hunter, ..."). */
const MAX_LENGTH = 80;

const { NotificationListenerModule } = NativeModules as {
  NotificationListenerModule?: {
    syncSignalSettings: (enabled: boolean, displayName: string) => Promise<string>;
  };
};

/**
 * The native listener reads these two values out of SharedPreferences while the JS runtime is
 * dead, so every write has to be mirrored across. `syncSignalSettings` atomically writes both,
 * which keeps the native copy consistent when only one of them changes.
 */
function mirrorToNative(enabled: boolean, displayName: string): void {
  if (Platform.OS !== 'android' || !NotificationListenerModule) return;
  void NotificationListenerModule.syncSignalSettings(enabled, displayName).catch(() => undefined);
}

/**
 * Explicitly disables signal detection in native SharedPreferences and local storage.
 * Called when EXPO_PUBLIC_SIGNAL_DETECTION is false so existing native builds stop detecting.
 */
export function disableSignalDetection(): void {
  void AsyncStorage.setItem(STORAGE_KEY_ENABLED, 'false').catch(() => undefined);
  mirrorToNative(false, '');
}

export function syncSignalSettings(enabled: boolean, displayName: string = ''): void {
  mirrorToNative(enabled, displayName);
}

export type SignalSourceState = {
  displayName: string;
  setDisplayName: (value: string) => void;
  isEnabled: boolean;
  setIsEnabled: (value: boolean) => void;
  isLoading: boolean;
};

const DISABLED_SIGNAL_SOURCE: SignalSourceState = {
  displayName: DEFAULT_DISPLAY_NAME,
  setDisplayName: () => {},
  isEnabled: false,
  setIsEnabled: () => {},
  isLoading: false,
};

function useSignalSourceDisabled(): SignalSourceState {
  return DISABLED_SIGNAL_SOURCE;
}

function useSignalSourceActive(): SignalSourceState {
  const [displayName, setName] = useState(DEFAULT_DISPLAY_NAME);
  const [isEnabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const hydratedRef = useRef(false);

  // The two setters each need the other's current value to mirror an atomic pair, so the
  // latest values are held in refs rather than read from state inside the callbacks.
  const enabledRef = useRef(false);
  const nameRef = useRef(DEFAULT_DISPLAY_NAME);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_ENABLED),
      AsyncStorage.getItem(STORAGE_KEY_DISPLAY_NAME),
    ])
      .then(([enabledRaw, nameRaw]) => {
        if (cancelled) return;

        const enabled = enabledRaw === 'true';
        const trimmed = nameRaw?.trim();
        const name = trimmed ? trimmed.slice(0, MAX_LENGTH) : DEFAULT_DISPLAY_NAME;

        enabledRef.current = enabled;
        nameRef.current = name;
        setEnabled(enabled);
        setName(name);
        // Mirror the hydrated defaults too: without this the native prefs stay empty until the
        // user first touches a control, and detection would use the native fallbacks instead.
        mirrorToNative(enabled, name);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        hydratedRef.current = true;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setDisplayName = useCallback((value: string) => {
    const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    const next = cleaned || DEFAULT_DISPLAY_NAME;
    nameRef.current = next;
    setName(next);
    void AsyncStorage.setItem(STORAGE_KEY_DISPLAY_NAME, next).catch(() => undefined);
    mirrorToNative(enabledRef.current, next);
  }, []);

  const setIsEnabled = useCallback((value: boolean) => {
    enabledRef.current = value;
    setEnabled(value);
    void AsyncStorage.setItem(STORAGE_KEY_ENABLED, String(value)).catch(() => undefined);
    mirrorToNative(value, nameRef.current);
  }, []);

  return { displayName, setDisplayName, isEnabled, setIsEnabled, isLoading };
}

/**
 * Manages signal detection settings: enabled state and display name for the signal source.
 * Both values are persisted in AsyncStorage and mirrored into the native listener's
 * SharedPreferences so detection still works when the app process is not running.
 */
export const useSignalSource = SIGNAL_DETECTION_ENABLED
  ? useSignalSourceActive
  : useSignalSourceDisabled;
