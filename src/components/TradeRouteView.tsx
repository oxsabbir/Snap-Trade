import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoinDetail } from '@/components/CoinDetail';
import { OrderManagement } from '@/components/OrderManagement';
import { TradeScreen } from '@/components/TradeScreen';
import { useAccountBalance } from '@/hooks/useAccountBalance';
import { snapLog } from '@/lib/snapLog';
import { colors, radius, spacing } from '@/theme';

type Props = {
  symbol: string;
  name: string;
  decimals: number;
  /** Shown only when the screen is a pushed route rather than a tab. */
  onBack?: () => void;
};

/**
 * The trade screen's content, shared by the tab route and the signal deep-link route. The two
 * differ only in how they learn the symbol — the tab reads the active coin, the deep link reads
 * the URL — so the layout lives here rather than in each route.
 */
export function TradeRouteView({ symbol, name, decimals, onBack }: Props) {
  // The order form reads this from the shared store too, so this is one `/accounts` request
  // shared by both consumers rather than one each.
  const { available } = useAccountBalance();

  useEffect(() => {
    snapLog('TradeScreenFirstRender', symbol);
  }, [symbol]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {onBack ? (
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Back to markets"
          >
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
        </View>
      ) : null}
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
        <CoinDetail symbol={symbol} name={name} decimals={decimals} />
        <TradeScreen symbol={symbol} />
        <OrderManagement
          symbol={symbol}
          onDeposit={() => {}}
          onTutorial={() => {}}
          available={available}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  back: {
    alignSelf: 'flex-start',
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
  scroll: {
    flex: 1,
  },
  content: {
    // A section that fills the screen has to be allowed to grow past it, so the container is
    // not height-capped: this is what lets the order view scroll under the tab bar.
    flexGrow: 1,
    paddingBottom: spacing.lg,
  },
});
