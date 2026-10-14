import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, InteractionManager, StyleSheet, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { usePrivateFeed } from '@/hooks/usePrivateFeed';

import { ActiveCoinProvider } from '@/state/activeCoin';
import { ApiCredentialsProvider, useApiCredentials } from '@/state/apiCredentials';
import { NotificationListenerProvider } from '@/components/NotificationListenerProvider';
import { useSignalDeepLink } from '@/hooks/useSignalDeepLink';
import { useSignalSource } from '@/hooks/useSignalSource';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ActiveCoinProvider>
          <ApiCredentialsProvider>
            <NotificationListenerProvider>
              <RootNavigator />
            </NotificationListenerProvider>
          </ApiCredentialsProvider>
        </ActiveCoinProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { isLoading, isConnected } = useApiCredentials();
  // Handles a signal deep link that arrives while the app is already running. A cold launch is
  // resolved by the router before this mounts.
  useSignalDeepLink();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Protected guard={isLoading || isConnected}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={isLoading || !isConnected}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        {/* Not inside a Protected guard: these are reached by a notification deep link (which
            must open even mid-onboarding) and from Account. */}
        <Stack.Screen name="trade/[symbol]" />
        <Stack.Screen name="permissions" />
      </Stack>
      {isConnected ? <PrivateFeedRuntime /> : null}
      <SignalSettingsRuntime />
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
    const task = InteractionManager.runAfterInteractions(() => setShouldHydrate(true));
    return () => task.cancel();
  }, []);

  return shouldHydrate ? <SignalSettingsHydrator /> : null;
}

function SignalSettingsHydrator() {
  useSignalSource();
  return null;
}

const styles = StyleSheet.create({
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
});
