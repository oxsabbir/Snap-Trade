import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useNotificationListener } from '@/hooks/useNotificationListener';

export function NotificationListenerProvider({ children }: { children: React.ReactNode }) {
  // Initialize notification listener at app startup - only for X/Twitter app
  useNotificationListener(
    (notification) => {
      // Only process notifications from X/Twitter app
      if (notification.packageName === 'com.twitter.android') {
        console.log('📱 X app notification:', notification.title, notification.text?.substring(0, 50));
      }
    },
    (removed) => {
      if (removed.packageName === 'com.twitter.android') {
        console.log('📱 X app notification removed:', removed.packageName);
      }
    }
  );

  return <>{children}</>;
}