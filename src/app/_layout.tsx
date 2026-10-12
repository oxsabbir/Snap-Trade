import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { usePrivateFeed } from '@/hooks/usePrivateFeed';

import { ActiveCoinProvider } from '@/state/activeCoin';
import { ApiCredentialsProvider, useApiCredentials } from '@/state/apiCredentials';
import { NotificationListenerProvider } from '@/components/NotificationListenerProvider';
import { colors } from '@/theme';

function resolveTradeRoute(url: string | null): string | null {
  if (!url) return null;
  const normalized = url.trim();
  const match = normalized.match(/^snaptrade:\/\/trade\/(.+)$/i);
  if (!match) return null;
  const symbol = decodeURIComponent(match[1].split(/[?#]/, 1)[0] ?? '').trim();
  if (!symbol || !symbol.includes('-')) return null;
  return `/trade/${encodeURIComponent(symbol)}`;
}

export default function RootLayout() {
  const [isRouting, setIsRouting] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const handleUrl = (url: string | null) => {
      const route = resolveTradeRoute(url);
      if (!route) {
        if (isMounted) setIsRouting(false);
        return;
      }
      console.log('🔗 Deep link route resolved:', route, 'from url=', url);
      setTimeout(() => {
        router.replace(route);
        if (isMounted) setIsRouting(false);
      }, 0);
    };

    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => {
      isMounted = false;
      sub.remove();
    };
  }, []);

  if (isRouting) {
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <View style={styles.bootOverlay}>
            <ActivityIndicator color={colors.accent} />
          </View>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

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
      </Stack>
      {isConnected ? <PrivateFeedRuntime /> : null}
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
