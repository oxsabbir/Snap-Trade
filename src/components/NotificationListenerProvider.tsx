import { useNotificationListener } from '@/hooks/useNotificationListener';
import { checkForSignal, type XNotification } from '@/lib/signalDetection';

export function NotificationListenerProvider({ children }: { children: React.ReactNode }) {
  // Initialize notification listener at app startup - only for X/Twitter app
  useNotificationListener(
    (notification: { id: number; text: string; bigText: string; postTime: number; title: string; subText: string; packageName: string }) => {
      // Only process notifications from X/Twitter app
      if (notification.packageName === 'com.twitter.android') {
        const xNotif: XNotification = {
          id: notification.id,
          text: notification.text || '',
          bigText: notification.bigText || '',
          postTime: notification.postTime,
          title: notification.title || '',
          subText: notification.subText || '',
          packageName: notification.packageName,
        };

        console.log('📱 X app notification:', notification.title, notification.text?.substring(0, 50));

        const signalResult = checkForSignal(xNotif);
        if (signalResult.isSignal) {
          console.log(
            `📱 🔔 SIGNAL DETECTED: ${signalResult.ticker} | TP1: ${signalResult.tp1} | TP count: ${signalResult.tpCount}`
          );
        } else if (signalResult.ticker) {
          console.log(
            `📱 ${signalResult.ticker} not a signal (TPs: ${signalResult.tpCount})`
          );
        }
      }
    },
    (removed: { packageName: string; id: number }) => {
      if (removed.packageName === 'com.twitter.android') {
        console.log('📱 X app notification removed:', removed.packageName);
      }
    }
  );

  return <>{children}</>;
}