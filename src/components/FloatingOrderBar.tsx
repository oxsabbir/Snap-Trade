import { memo, useMemo } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Pressable, View } from '@/components/AppLayout';
import { Text } from '@/components/AppText';
import { useOpenOrders } from '@/hooks/useOpenOrders';
import { isTerminalStatus, type OpenOrder } from '@/state/openOrders';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';
import { formatAmount } from '@/utils/format';

type Props = {
  symbol: string;
};

function filledFraction(order: OpenOrder): number {
  const total = Number(order.size);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const filled = Number(order.filledSize);
  if (!Number.isFinite(filled) || filled <= 0) return 0;
  return Math.min(1, filled / total);
}

export const FloatingOrderBar = memo(function FloatingOrderBar({ symbol }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { orders, cancelling, cancelOrder } = useOpenOrders();

  const symbolOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.symbol === symbol &&
          !isTerminalStatus(o.status) &&
          filledFraction(o) < 1,
      ),
    [orders, symbol],
  );

  const activeOrder = symbolOrders[0] ?? null;

  const isCancelling = activeOrder ? cancelling.has(activeOrder.orderId) : false;

  const activeFillPercent = activeOrder
    ? Math.round(filledFraction(activeOrder) * 100)
    : 0;

  const activeRemainingText = useMemo(() => {
    if (!activeOrder) return '';
    const total = Number(activeOrder.size);
    const filled = Number(activeOrder.filledSize);
    const remaining = Math.max(0, total - (Number.isFinite(filled) ? filled : 0));
    const priceNum = Number(activeOrder.price);
    if (Number.isFinite(remaining) && Number.isFinite(priceNum) && priceNum > 0) {
      const usd = remaining * priceNum;
      return `Rem $${usd < 100 ? usd.toFixed(2) : formatAmount(usd)}`;
    }
    return `Rem ${formatAmount(remaining)}`;
  }, [activeOrder]);

  if (!activeOrder) return null;

  const sideColor = activeOrder.side === 'buy' ? colors.up : colors.down;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.bar}>
        <View style={styles.info}>
          <View style={[styles.dot, { backgroundColor: sideColor }]} />
          <Text style={styles.text} numberOfLines={1} ellipsizeMode="tail">
            {activeOrder.side === 'buy' ? 'Buy' : 'Sell'} {activeFillPercent}% · {activeRemainingText}
          </Text>
        </View>

        <Pressable
          onPress={() => void cancelOrder(activeOrder.orderId)}
          disabled={isCancelling}
          style={[styles.cancelBtn, isCancelling && styles.cancelBtnDisabled]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Cancel unfilled ${activeOrder.side} order`}
        >
          {isCancelling ? (
            <ActivityIndicator size="small" color={colors.downText} />
          ) : (
            <Text style={styles.cancelText}>Cancel</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
});

const BAR_WIDTH = 216;
const BAR_HEIGHT = 32;

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      bottom: 8,
      right: spacing.md,
      zIndex: 30,
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
    },
    bar: {
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingLeft: 8,
      paddingRight: 4,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3,
      elevation: 4,
    },
    info: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flex: 1,
      minWidth: 0,
      paddingRight: 4,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    text: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    cancelBtn: {
      height: 24,
      paddingHorizontal: 9,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      backgroundColor: colors.downFill,
    },
    cancelBtnDisabled: {
      opacity: 0.6,
    },
    cancelText: {
      color: colors.downText,
      fontSize: 11,
      fontWeight: '700',
    },
  })
);
