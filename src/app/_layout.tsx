import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { ActiveCoinProvider } from '@/state/activeCoin';
import { colors } from '@/theme';
import { usePrivateFeed } from '@/hooks/usePrivateFeed';

export default function RootLayout() {
  // App-wide, so an order filled or cancelled on the desktop lands even while the user is on
  // another tab. Mounted here rather than on the trade screen for exactly that reason.
  usePrivateFeed();

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ActiveCoinProvider>
        <View style={styles.root}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: 'fade',
            }}
          />
        </View>
      </ActiveCoinProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
