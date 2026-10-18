import {
  Redirect,
  router } from 'expo-router';
import { Pressable, ScrollView, View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAndroidPermissions } from '@/hooks/useAndroidPermissions';
import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';
import { radius, spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themedStyles';

type RowProps = {
  title: string;
  description: string;
  granted: boolean;
  actionLabel: string;
  onPress: () => void;
};

function PermissionRow({ title, description, granted, actionLabel, onPress }: RowProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      {granted ? (
        <Text style={styles.granted}>Granted</Text>
      ) : (
        <Pressable
          onPress={onPress}
          style={styles.rowButton}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.rowButtonText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Home for the permissions the signal pipeline depends on. Kept out of the Account tab so the
 * setup needed to make detection reliable has a page of its own.
 *
 * The route file always exists (Expo Router is file-based and typed routes reference it), but
 * in a build with signal detection stripped this redirects home the moment it mounts — the
 * feature flag is a bundle-time literal, so the rest of the screen is dead code.
 */
export default function PermissionsScreen() {
  if (!SIGNAL_DETECTION_ENABLED) return <Redirect href="/(tabs)" />;
  return <PermissionsContent />;
}

function PermissionsContent() {
  const styles = useStyles();
  const {
    status,
    requestNotificationAccess,
    requestOverlay,
    openBatterySettings,
    openAutostart,
  } = useAndroidPermissions();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Permissions</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Signal detection reads notifications and opens the trade screen directly. These Android
          settings keep that working when the app is in the background or was closed.
        </Text>

        <PermissionRow
          title="Notification access"
          description="Required. Lets the app read incoming notifications to detect a signal."
          granted={status.notificationAccess}
          actionLabel="Open settings"
          onPress={requestNotificationAccess}
        />
        <PermissionRow
          title="Display over other apps"
          description="Recommended. Android blocks screens opening from the background without it, so the launch can be dropped."
          granted={status.overlay}
          actionLabel="Allow"
          onPress={requestOverlay}
        />
        <PermissionRow
          title="Ignore battery optimisation"
          description="Recommended. Stops the system from suspending the listener when the app is idle."
          granted={status.ignoringBatteryOptimizations}
          actionLabel="Allow"
          onPress={openBatterySettings}
        />
        <PermissionRow
          title="Autostart"
          description="Recommended on Xiaomi, Huawei, Oppo, Vivo and Samsung. Lets the listener restart after a reboot."
          granted={false}
          actionLabel="Open"
          onPress={openAutostart}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    back: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    backText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    title: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
    },
    list: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
    intro: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: spacing.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    rowDesc: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    granted: {
      color: colors.up,
      fontSize: 12,
      fontWeight: '700',
    },
    rowButton: {
      paddingHorizontal: spacing.md,
      height: 34,
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    rowButtonText: {
      color: colors.onAccent,
      fontSize: 12,
      fontWeight: '700',
    },
  }),
);
