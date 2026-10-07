import { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, Platform, Alert, ScrollView } from 'react-native';

import { useNotificationListener, requestNotificationPermission, checkNotificationPermission } from '@/hooks/useNotificationListener';

export function NotificationListenerDemo() {
  const [hasPermission, setHasPermission] = useState(false);
  const [notifications, setNotifications] = useState<{
    packageName: string;
    title: string;
    text: string;
    time: string;
  }[]>([]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    checkNotificationPermission().then(setHasPermission);
  }, []);

  useNotificationListener(
    (notification) => {
      setNotifications((prev) => [
        {
          packageName: notification.packageName,
          title: notification.title,
          text: notification.text,
          time: new Date(notification.postTime).toLocaleTimeString(),
        },
        ...prev.slice(0, 49),
      ]);
    },
    (removed) => {
      setNotifications((prev) => prev.filter((n) => n.packageName !== removed.packageName));
    }
  );

  const handleRequestPermission = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Not supported', 'Notification listener only works on Android');
      return;
    }

    const granted = await requestNotificationPermission();
    setHasPermission(granted);
    if (!granted) {
      Alert.alert(
        'Permission Required',
        'Please enable notification access for this app in the settings screen that opened.',
        [{ text: 'OK' }]
      );
    }
  };

  if (Platform.OS !== 'android') {
    return (
      <View style={styles.container}>
        <Text style={styles.unsupportedText}>Notification listener only works on Android</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Notification Listener Demo</Text>
      
      <View style={styles.statusRow}>
        <Text style={styles.label}>Permission Status:</Text>
        <Text style={[styles.value, hasPermission ? styles.granted : styles.denied]}>
          {hasPermission ? '✅ Granted' : '❌ Not Granted'}
        </Text>
      </View>

      <Button
        title={hasPermission ? 'Permission Granted' : 'Request Notification Permission'}
        onPress={handleRequestPermission}
        disabled={hasPermission}
        color="#007AFF"
      />

      <View style={styles.listContainer}>
        <Text style={styles.listHeader}>Recent Notifications ({notifications.length})</Text>
        <ScrollView style={styles.scrollView}>
          {notifications.length === 0 ? (
            <Text style={styles.emptyText}>No notifications received yet. Enable permission and wait for notifications from other apps (like X/Twitter, WhatsApp, etc.)</Text>
          ) : (
            notifications.map((n, i) => (
              <View key={i} style={styles.notificationCard}>
                <Text style={styles.notificationPackage}>{n.packageName}</Text>
                <Text style={styles.notificationTitle}>{n.title}</Text>
                <Text style={styles.notificationText}>{n.text}</Text>
                <Text style={styles.notificationTime}>{n.time}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#1a1a1a',
  },
  header: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: '#888',
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
  granted: {
    color: '#4ade80',
  },
  denied: {
    color: '#f87171',
  },
  listContainer: {
    marginTop: 16,
  },
  listHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  scrollView: {
    maxHeight: 400,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  notificationCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  notificationPackage: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
    marginBottom: 4,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  notificationText: {
    fontSize: 13,
    color: '#ccc',
    marginBottom: 4,
  },
  notificationTime: {
    fontSize: 11,
    color: '#666',
  },
  unsupportedText: {
    color: '#666',
    fontSize: 16,
    textAlign: 'center',
    padding: 20,
  },
});