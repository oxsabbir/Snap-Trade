import { useCallback, useEffect, useState } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';

export type PermissionStatus = {
  notificationAccess: boolean;
  overlay: boolean;
  ignoringBatteryOptimizations: boolean;
};

const UNKNOWN: PermissionStatus = {
  notificationAccess: false,
  overlay: false,
  ignoringBatteryOptimizations: false,
};

type NotificationPermissionModule = {
  getPermissionStatus: () => Promise<PermissionStatus>;
  requestPermission: () => Promise<void>;
  requestOverlayPermission: () => Promise<void>;
  openBatteryOptimizationSettings: () => void;
  openAutostartSettings: () => void;
};

const native = (NativeModules.NotificationListenerModule ??
  null) as NotificationPermissionModule | null;

/**
 * Explains why the three Android permissions matter and links straight to the relevant system
 * page. Preventative maintenance, not a blocker: every action is best-effort and the row keeps
 * the last known status if a lookup fails.
 */
export function useAndroidPermissions() {
  const [status, setStatus] = useState<PermissionStatus>(UNKNOWN);
  // Only Android has anything to load, so initialise `false` elsewhere and skip the effect's
  // synchronous setState (which the hooks lint rule rejects).
  const [isLoading, setIsLoading] = useState(Platform.OS === 'android' && native != null);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'android' || !native) {
      setIsLoading(false);
      return;
    }
    try {
      const next = await native.getPermissionStatus();
      setStatus(next);
    } catch {
      // Keep the previous reading rather than flashing an incorrect "denied".
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !native) return;
    let cancelled = false;
    native
      .getPermissionStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // These are granted in the system UI, so the only signal that something changed is the app
  // coming back to the foreground.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const requestNotificationAccess = useCallback(() => {
    void native?.requestPermission();
  }, []);

  const requestOverlay = useCallback(() => {
    void native?.requestOverlayPermission();
  }, []);

  const openBatterySettings = useCallback(() => {
    native?.openBatteryOptimizationSettings();
  }, []);

  const openAutostart = useCallback(() => {
    native?.openAutostartSettings();
  }, []);

  return {
    status,
    isLoading,
    refresh,
    requestNotificationAccess,
    requestOverlay,
    openBatterySettings,
    openAutostart,
  };
}
