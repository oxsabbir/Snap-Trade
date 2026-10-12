import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { SignalPrefsModule } = NativeModules;

const STORAGE_KEY_ENABLED = 'signal_detection_enabled';
const STORAGE_KEY_DISPLAY_NAME = 'signal_source:display-name';
const DEFAULT_DISPLAY_NAME = 'My Signal Source';
const MAX_LENGTH = 24;

export type SignalSourceState = {
  displayName: string;
  setDisplayName: (value: string) => void;
  isEnabled: boolean;
  setIsEnabled: (value: boolean) => void;
  isLoading: boolean;
};

/**
 * Manages signal detection settings: enabled state and display name for the signal source.
 * Both values are persisted in AsyncStorage.
 */
function mirrorSignalSettings(enabled: boolean, displayName: string) {
  if (Platform.OS !== 'android' || !SignalPrefsModule) return;

  const nativePrefs = SignalPrefsModule as {
    writeSignalSettings?: (payload: { enabled: boolean; displayName: string }) => Promise<boolean>;
  };

  if (!nativePrefs.writeSignalSettings) return;

  void nativePrefs.writeSignalSettings({ enabled, displayName }).catch((error: unknown) => {
    console.warn('🔧 useSignalSource: Failed to mirror settings to native prefs:', error);
  });
}

export function useSignalSource(): SignalSourceState {
  const [displayName, setName] = useState(DEFAULT_DISPLAY_NAME);
  const [isEnabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    console.log('🔧 useSignalSource: Loading from AsyncStorage...');
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_ENABLED),
      AsyncStorage.getItem(STORAGE_KEY_DISPLAY_NAME),
    ])
      .then(([enabledRaw, nameRaw]) => {
        if (cancelled) return;
        console.log('🔧 useSignalSource: Loaded from storage:', { enabledRaw, nameRaw });
        let enabled = false;
        if (enabledRaw !== null) {
          enabled = enabledRaw === 'true';
          console.log('🔧 useSignalSource: Setting enabled:', enabled);
          setEnabled(enabled);
        }
        const trimmed = nameRaw?.trim();
        const nextName = trimmed ? trimmed.slice(0, MAX_LENGTH) : DEFAULT_DISPLAY_NAME;
        console.log('🔧 useSignalSource: Setting displayName:', nextName);
        setName(nextName);
        mirrorSignalSettings(enabled, nextName);
      })
      .catch((e) => {
        console.error('🔧 useSignalSource: Load error:', e);
      })
      .finally(() => {
        if (cancelled) return;
        hydratedRef.current = true;
        setIsLoading(false);
        console.log('🔧 useSignalSource: Loading complete');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setDisplayName = useCallback((value: string) => {
    const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    const next = cleaned || DEFAULT_DISPLAY_NAME;
    console.log('🔧 useSignalSource: setDisplayName called with:', value, '-> saving:', next);
    setName(next);
    void AsyncStorage.setItem(STORAGE_KEY_DISPLAY_NAME, next).catch((e) => console.error('🔧 useSignalSource: Save error:', e));
    mirrorSignalSettings(isEnabled, next);
  }, [isEnabled]);

  const setIsEnabled = useCallback((value: boolean) => {
    console.log('🔧 useSignalSource: setIsEnabled called with:', value);
    setEnabled(value);
    void AsyncStorage.setItem(STORAGE_KEY_ENABLED, String(value)).catch((e) => console.error('🔧 useSignalSource: Save enabled error:', e));
    mirrorSignalSettings(value, displayName);
  }, [displayName]);

  return { displayName, setDisplayName, isEnabled, setIsEnabled, isLoading };
}