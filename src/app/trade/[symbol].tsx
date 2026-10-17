import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TradeRouteView } from '@/components/TradeRouteView';
import { useAndroidPermissions } from '@/hooks/useAndroidPermissions';
import { useSignalLaunch } from '@/hooks/useSignalLaunch';
import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';
import { normalizeTradeSymbol } from '@/lib/signalUrl';
import { radius, spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themedStyles';

/**
 * Landing screen for `snaptrade://trade/<symbol>`.
 *
 * This is a root-level route rather than a child of `(tabs)` on purpose: a cold launch from a
 * notification resolves the URL before anything else, so this screen becomes the initial route
 * and the Home tab never has to mount first.
 *
 * The route file always exists (Expo Router is file-based and typed routes reference it), but
 * in a build with signal detection stripped this redirects home the moment it mounts — the
 * feature flag is a bundle-time literal, so the rest of the screen is dead code.
 */
export default function TradeDeepLinkRoute() {
  if (!SIGNAL_DETECTION_ENABLED) return <Redirect href="/(tabs)" />;
  return <TradeDeepLinkContent />;
}

function TradeDeepLinkContent() {
  const styles = useStyles();
  const params = useLocalSearchParams<{ symbol?: string | string[] }>();
  const raw = Array.isArray(params.symbol) ? params.symbol[0] : params.symbol;
  const symbol = normalizeTradeSymbol(raw);

  const launch = useSignalLaunch();
  const { status } = useAndroidPermissions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (symbol) launch(symbol, 'deep-link');
  }, [symbol, launch]);

  if (!symbol) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Unknown signal</Text>
        <Text style={styles.emptyBody}>This link did not include a tradeable pair.</Text>
        <Pressable
          onPress={() => router.navigate('/(tabs)')}
          style={styles.cta}
          accessibilityRole="button"
          accessibilityLabel="Browse markets"
        >
          <Text style={styles.ctaText}>Browse markets</Text>
        </Pressable>
      </View>
    );
  }

  const base = symbol.split('-')[0] ?? symbol;

  return (
    <View style={styles.root}>
      <TradeRouteView
        symbol={symbol}
        name={base}
        decimals={8}
        onBack={() => router.navigate('/(tabs)/trade')}
      />
      {!status.notificationAccess ? (
        <Pressable
          onPress={() => router.navigate('/permissions')}
          style={[styles.banner, { bottom: insets.bottom + spacing.md }]}
          accessibilityRole="button"
          accessibilityLabel="Open permissions"
        >
          <Text style={styles.bannerText}>
            Notification access is off. Future signals will not arrive.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    emptyBody: {
      color: colors.textMuted,
      fontSize: 13,
      textAlign: 'center',
    },
    cta: {
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
      height: 38,
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    ctaText: {
      color: colors.onAccent,
      fontSize: 13,
      fontWeight: '700',
    },
    banner: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
    },
    bannerText: {
      color: colors.text,
      fontSize: 12,
      textAlign: 'center',
    },
  }),
);
