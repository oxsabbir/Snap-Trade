import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { usePrivateFeed } from '@/hooks/usePrivateFeed';

import { ActiveCoinProvider } from '@/state/activeCoin';
import { ApiCredentialsProvider, useApiCredentials } from '@/state/apiCredentials';
import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ActiveCoinProvider>
          <ApiCredentialsProvider>
            <RootNavigator />
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
