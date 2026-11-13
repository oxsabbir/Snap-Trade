/**
 * Trading mode — the manual gate for background feed warmth.
 *
 * Semantics (decided with the user):
 *  - While the app is in the foreground the native WebSocket keepalive always runs, regardless
 *    of this toggle.
 *  - In the background, the keepalive (and the public socket itself) only runs when trading
 *    mode is ON. Off is the default: no feed, no pings, no battery.
 *
 * The value lives in SecureStore for the UI and is mirrored into native SharedPreferences so
 * `NetworkHardening` can decide at dial time whether a socket gets protocol pings — the same
 * mirror pattern the signal-detection toggle uses, because the native layer must not depend on
 * the JS runtime.
 */
import { NativeModules, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'trading_mode.enabled';

const { NotificationListenerModule } = NativeModules as {
  NotificationListenerModule?: {
    syncKeepaliveMode: (enabled: boolean) => Promise<boolean>;
  };
};

/** Synchronous cache for the AppState listener, which cannot await SecureStore. */
let cached = false;

function mirrorToNative(enabled: boolean): void {
  if (Platform.OS !== 'android' || !NotificationListenerModule) return;
  void NotificationListenerModule.syncKeepaliveMode(enabled).catch(() => undefined);
}

export function isTradingModeEnabled(): boolean {
  return cached;
}

/** Reads the persisted value once at module load; the AppState listener reads the cache. */
export async function hydrateTradingMode(): Promise<void> {
  try {
    cached = (await SecureStore.getItemAsync(KEY)) === 'true';
  } catch {
    cached = false;
  }
  // Mirror the hydrated value too: without this the native prefs stay at their default until
  // the user first touches the toggle.
  mirrorToNative(cached);
}

export async function setTradingModeEnabled(enabled: boolean): Promise<void> {
  cached = enabled;
  try {
    await SecureStore.setItemAsync(KEY, String(enabled));
  } catch {
    // Persisted state is best-effort; the in-memory cache still drives this session.
  }
  mirrorToNative(enabled);
}

/**
 * Re-evaluates the gate right after the toggle changes — lives in `publicSocket` as
 * `reapplyTradingMode`; this module stays free of socket imports.
 */
void hydrateTradingMode();
