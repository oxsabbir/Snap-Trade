import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoinDetail } from '@/components/CoinDetail';
import { TradeScreen } from '@/components/TradeScreen';
import { useActiveCoin } from '@/state/activeCoin';
import { colors, radius, spacing } from '@/theme';

export default function TradeScreenRoute() {
  const coin = useActiveCoin();

  if (!coin) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No coin selected</Text>
        <Text style={styles.emptyBody}>Pick a pair from Markets to load its chart here.</Text>
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* One scroll view for the whole screen, so the sections below the chart are added as
          siblings here rather than each bringing its own scrolling. Nothing below may nest a
          scroll view of its own; a section that outgrows the screen grows this one instead. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        // The chart handles its own two-finger pinch to zoom the candles. Left enabled, iOS
        // gives the same gesture to the scroll view and page-zooms the layout underneath it.
        maximumZoomScale={1}
        showsVerticalScrollIndicator={false}
      >
        <CoinDetail symbol={coin.symbol} name={coin.name} decimals={coin.decimals}>
          <TradeScreen symbol={coin.symbol} />
        </CoinDetail>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    // A section that fills the screen has to be allowed to grow past it, so the container is
    // not height-capped: this is what lets the order view scroll under the tab bar.
    flexGrow: 1,
    paddingBottom: spacing.lg,
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
    color: '#06231C',
    fontSize: 13,
    fontWeight: '700',
  },
});
