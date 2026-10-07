import { useEffect } from 'react';
import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

const { NotificationListenerModule } = NativeModules;

console.log('📱 NotificationListenerModule loaded:', NotificationListenerModule ? 'YES' : 'NO');

export type NotificationEvent = {
  packageName: string;
  title: string;
  text: string;
  bigText: string;
  subText: string;
  postTime: number;
  id: number;
};

export type NotificationRemovedEvent = {
  packageName: string;
  id: number;
};

export function useNotificationListener(
  onNotificationPosted?: (notification: NotificationEvent) => void,
  onNotificationRemoved?: (notification: NotificationRemovedEvent) => void
) {
  useEffect(() => {
    if (Platform.OS !== 'android') {
      console.log('📱 Not Android, skipping notification listener');
      return;
    }

    if (!NotificationListenerModule) {
      console.error('❌ NotificationListenerModule not found in NativeModules!');
      console.log('Available modules:', Object.keys(NativeModules));
      return;
    }

    console.log('📱 Setting up notification listener...');

    const postedSubscription = DeviceEventEmitter.addListener(
      'NotificationPosted',
      (notification: NotificationEvent) => {
        console.log('🔔🔔🔔 NOTIFICATION POSTED EVENT RECEIVED:', JSON.stringify(notification, null, 2));
        onNotificationPosted?.(notification);
      }
    );

    const removedSubscription = DeviceEventEmitter.addListener(
      'NotificationRemoved',
      (notification: NotificationRemovedEvent) => {
        console.log('🔕🔕🔕 NOTIFICATION REMOVED EVENT RECEIVED:', JSON.stringify(notification, null, 2));
        onNotificationRemoved?.(notification);
      }
    );

    console.log('📱 Notification listener subscriptions active');

    return () => {
      console.log('📱 Cleaning up notification listener...');
      postedSubscription.remove();
      removedSubscription.remove();
    };
  }, [onNotificationPosted, onNotificationRemoved]);
}

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !NotificationListenerModule) return false;

  try {
    // Check if permission is already granted
    const isGranted = await NotificationListenerModule.isPermissionGranted();
    if (isGranted) return true;

    // Request permission
    await NotificationListenerModule.requestPermission();
    
    // Check again after user returns
    return await NotificationListenerModule.isPermissionGranted();
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return false;
  }
};

export const checkNotificationPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || !NotificationListenerModule) return false;
  
  try {
    return await NotificationListenerModule.isPermissionGranted();
  } catch (error) {
    console.error('Failed to check notification permission:', error);
    return false;
  }
};