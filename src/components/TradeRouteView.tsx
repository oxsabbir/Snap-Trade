import { useCallback } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoinDetail } from '@/components/CoinDetail';
import { OrderManagement } from '@/components/OrderManagement';
import { TradeScreen } from '@/components/TradeScreen';
import { useAccountBalance } from '@/hooks/useAccountBalance';
import { loadMoreOrderHistory } from '@/state/orderHistory';
import { radius, spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themedStyles';

type Props = {
  symbol: string;
  name: string;
  decimals: number;
  /** Shown only when the screen is a pushed route rather than a tab. */
  onBack?: () => void;
};

/**
 * How close to the bottom of the page, in points, the History tab asks for its next page. Wide
 * enough that the rows land before the user reaches the end, without firing pages they never see.
 */
const HISTORY_LOAD_MORE_THRESHOLD = 320;

/**
 * The trade screen's content: the chart, the order form, and the order management section, with the
 * symbol supplied by the tab route that owns the screen's only scroll view.
 */
export function TradeRouteView({ symbol, name, decimals, onBack }: Props) {
  const styles = useStyles();
  // The order form reads this from the shared store too, so this is one `/accounts` request
  // shared by both consumers rather than one each.
  const { available } = useAccountBalance();

  // The route owns the screen's only scroll view, so the History tab cannot detect its own end:
  // this polls how far the page has scrolled and pokes the history store, which ignores the signal
  // unless History is open with an older page to fetch.
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - contentOffset.y - layoutMeasurement.height;
      if (distanceFromBottom <= HISTORY_LOAD_MORE_THRESHOLD) {
        void loadMoreOrderHistory(symbol);
      }
    },
    [symbol],
  );

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
        onScroll={handleScroll}
        scrollEventThrottle={16}
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

const useStyles = createThemedStyles((colors) => StyleSheet.create({
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
}));
