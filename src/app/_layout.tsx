import { useEffect, useMemo } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { usePrivateFeed } from '@/hooks/usePrivateFeed';

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

  // Keeps the root view (behind the navigator, and visible during transitions) in step with the
  // active scheme so no wrong-coloured edge flashes when a screen animates.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg);
  }, [colors.bg]);

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
      {Platform.OS === 'android' ? (
        <NavigationBar style={scheme === 'dark' ? 'dark' : 'light'} />
      ) : null}
      <Stack screenOptions={screenOptions}>
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
