import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { usePrivateFeed } from '@/hooks/usePrivateFeed';
import { useSignalDeepLink } from '@/hooks/useSignalDeepLink';
import { useSignalSource } from '@/hooks/useSignalSource';
import { SIGNAL_DETECTION_ENABLED } from '@/lib/featureFlags';

import { ActiveCoinProvider } from '@/state/activeCoin';
import { ApiCredentialsProvider, useApiCredentials } from '@/state/apiCredentials';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ThemeProvider>
          <ActiveCoinProvider>
            <ApiCredentialsProvider>
              <RootNavigator />
            </ApiCredentialsProvider>
          </ActiveCoinProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { isLoading, isConnected } = useApiCredentials();
  const { colors, scheme } = useTheme();
  const styles = useStyles();

  // Handles a signal deep link that arrives while the app is already running. A cold launch is
  // resolved by the router before this mounts. No-ops (and is tree-shaken) when the feature is
  // stripped from the build.
  useSignalDeepLink();

  // Keeps the root view (behind the navigator, and visible during transitions) in step with the
  // active scheme so no wrong-coloured edge flashes when a screen animates.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg);
  }, [colors.bg]);

  // Drives the Android navigation-bar button color from the active scheme. Imperative rather than
  // the <NavigationBar> component: the component fires a native setHidden on unmount, which rejects
  // ("the current activity is no longer available") when a Metro/dev-client reload tears the tree
  // down after the Activity is gone. setStyle has no unmount path, so nothing is called on teardown.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setStyle(scheme === 'dark' ? 'dark' : 'light');
  }, [scheme]);

  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      contentStyle: { backgroundColor: colors.bg },
      animation: 'fade' as const,
    }),
    [colors.bg],
  );

  return (
    <View style={styles.root}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={screenOptions}>
        <Stack.Protected guard={isLoading || isConnected}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={isLoading || !isConnected}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* Not inside a Protected guard: these are reached by a notification deep link (which
            must open even mid-onboarding) and from Account. The route files exist either way
            (Expo Router is file-based); with signal detection stripped they immediately redirect
            back to the tabs. Rendered as separate conditionals — not wrapped in a Fragment —
            because Stack inspects its direct children and a Fragment's type is a Symbol it
            cannot stringify. */}
        {SIGNAL_DETECTION_ENABLED ? <Stack.Screen name="trade/[symbol]" /> : null}
        {SIGNAL_DETECTION_ENABLED ? <Stack.Screen name="permissions" /> : null}
      </Stack>
      {isConnected ? <PrivateFeedRuntime /> : null}
      {SIGNAL_DETECTION_ENABLED ? <SignalSettingsRuntime /> : null}
      {isLoading ? (
        <View style={styles.bootOverlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

function PrivateFeedRuntime() {
  usePrivateFeed();
  return null;
}

/**
 * Mounted once so the signal settings hydrate and mirror into the native listener's
 * SharedPreferences on every launch, not only when the Account tab happens to be opened.
 *
 * Deferred past the first interactions so its two AsyncStorage reads and the native
 * `syncSignalSettings` round-trip do not compete with the first paint. Nothing depends on the
 * hydrated values until the user opens the signal settings screen.
 */
function SignalSettingsRuntime() {
  const [shouldHydrate, setShouldHydrate] = useState(false);

  useEffect(() => {
    // Idle callback rather than the deprecated InteractionManager: hydration is not tied to
    // transition completion — it only needs a moment when the JS thread is not busy.
    const task = requestIdleCallback(() => setShouldHydrate(true));
    return () => cancelIdleCallback(task);
  }, []);

  return shouldHydrate ? <SignalSettingsHydrator /> : null;
}

function SignalSettingsHydrator() {
  useSignalSource();
  return null;
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
});

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    bootOverlay: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
    },
  }),
);
