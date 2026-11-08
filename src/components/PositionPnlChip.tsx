import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from '@/components/AppLayout';
import { ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { useAccountBalance } from '@/hooks/useAccountBalance';
import { useCostBasis } from '@/hooks/useCostBasis';
import { useSymbolRules } from '@/hooks/useSymbolRules';
import { useUserTradeFees } from '@/hooks/useUserTradeFees';
import { describeError } from '@/lib/kucoin/errors';
import { validateLimitOrder } from '@/lib/kucoin/orderRules';
import { createClientOid, placeLimitOrder, TEST_MODE } from '@/lib/kucoin/orders';
import { derivePositionPnl } from '@/lib/quote';
import { isPositive, prefillPrice } from '@/lib/trade';
import { trackPlacedOrder } from '@/state/openOrders';
import { useTicker } from '@/state/ticker';
import { createThemedStyles } from '@/theme/themedStyles';
import { useTheme } from '@/theme/ThemeProvider';
import { snapToIncrement } from '@/utils/decimal';
import { formatSignedUsd } from '@/utils/format';

type Props = {
  symbol: string;
  /** The last candle's close, used until the socket's first tick lands. */
  fallbackPrice?: number;
};

/** Double-tap interval in ms to trigger instant exit. */
const DOUBLE_TAP_DELAY_MS = 350;

/**
 * Unrealised profit or loss on the position in the pair being viewed, as a chip beside the price.
 *
 * Distinct from the market-change pill in `LivePrice`: that one is the coin's move, this one is
 * the user's own money. The entry price comes from the persisted cost-basis ledger, but the size is
 * the *live balance* rather than the ledger's net quantity — so the chip appears the moment the
 * socket reports the buy and disappears the instant the balance reaches zero on a full exit, and
 * the figure always reflects what is actually held rather than what a fill history claims.
 *
 * When in profit, the chip becomes interactive: a quick double-tap places a limit sell order at
 * the current price for 100% of available assets to lock in profit.
 */
export function PositionPnlChip({ symbol, fallbackPrice }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { update } = useTicker(symbol);
  const { available, holds } = useAccountBalance();
  const basis = useCostBasis(symbol);
  const { rules } = useSymbolRules(symbol);
  const { takerFeeRate } = useUserTradeFees(symbol);

  const [base, quote = 'USDT'] = symbol.split('-');
  const baseCurrency = base ?? '';
  const availableBase = available[baseCurrency] ?? '0';
  const held = (Number(availableBase) || 0) + (Number(holds[baseCurrency]) || 0);
  const pnl = held > 0 ? derivePositionPnl(update?.price ?? fallbackPrice, basis.avgCost, String(held)) : null;

  const isInteractive = Boolean(pnl && pnl.isUp && pnl.amount > 0 && Number(availableBase) > 0);

  const [scaleAnim] = useState(() => new Animated.Value(1));
  const lastTapRef = useRef<number>(0);
  const primeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPrimed, setIsPrimed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (primeTimerRef.current) clearTimeout(primeTimerRef.current);
    };
  }, []);

  const handlePressIn = useCallback(() => {
    if (!isInteractive || isSubmitting) return;
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      speed: 50,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  }, [isInteractive, isSubmitting, scaleAnim]);

  const handlePressOut = useCallback(() => {
    if (!isInteractive || isSubmitting) return;
    Animated.spring(scaleAnim, {
      toValue: 1,
      speed: 40,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  }, [isInteractive, isSubmitting, scaleAnim]);

  const executeQuickSell = useCallback(async () => {
    const currentPrice = update?.price ?? fallbackPrice;
    if (!currentPrice || !rules || isSubmitting) return;

    const price = prefillPrice(rules, currentPrice);
    if (!price) return;

    const size = snapToIncrement(availableBase, rules.baseIncrement, 'floor');
    if (!size || !isPositive(size)) return;

    const effectiveFeeRate = takerFeeRate ?? '0.001';
    const check = validateLimitOrder(
      { side: 'sell', symbol, price, size },
      rules,
      { base: availableBase, quote: available[quote] ?? '0' },
      effectiveFeeRate,
    );

    if (!check.valid || !check.normalized) {
      setErrorMessage(check.issues[0]?.message ?? 'Invalid order');
      setTimeout(() => setErrorMessage(null), 2500);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const clientOid = createClientOid();
      const placed = await placeLimitOrder(
        {
          clientOid,
          side: 'sell',
          symbol,
          price: check.normalized.price,
          size: check.normalized.size,
        },
        { test: TEST_MODE },
      );

      if (!TEST_MODE) {
        trackPlacedOrder(
          { orderId: placed.orderId, clientOid },
          {
            symbol,
            side: 'sell',
            price: check.normalized.price,
            size: check.normalized.size,
          },
        );
      }
    } catch (caught) {
      setErrorMessage(describeError(caught, 'Sell failed'));
      setTimeout(() => setErrorMessage(null), 2500);
    } finally {
      setIsSubmitting(false);
    }
  }, [update?.price, fallbackPrice, rules, isSubmitting, availableBase, takerFeeRate, symbol, quote, available]);

  const handlePress = useCallback(() => {
    if (!isInteractive || isSubmitting) return;

    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY_MS) {
      // Second tap within threshold: execute quick sell!
      lastTapRef.current = 0;
      if (primeTimerRef.current) {
        clearTimeout(primeTimerRef.current);
        primeTimerRef.current = null;
      }
      setIsPrimed(false);
      void executeQuickSell();
    } else {
      // First tap: prime for double tap and show visual cue
      lastTapRef.current = now;
      setIsPrimed(true);
      if (primeTimerRef.current) clearTimeout(primeTimerRef.current);
      primeTimerRef.current = setTimeout(() => {
        setIsPrimed(false);
        lastTapRef.current = 0;
      }, DOUBLE_TAP_DELAY_MS);
    }
  }, [isInteractive, isSubmitting, executeQuickSell]);

  if (!pnl) return null;

  const content = (
    <Animated.View
      style={[
        styles.chip,
        {
          backgroundColor: pnl.isUp ? colors.upFill : colors.downFill,
          borderColor: isPrimed ? colors.up : colors.border,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      {isSubmitting ? (
        <ActivityIndicator size={12} color={colors.upText} />
      ) : errorMessage ? (
        <Text style={[styles.text, { color: colors.downText }]} numberOfLines={1}>
          ! Error
        </Text>
      ) : isPrimed ? (
        <Text style={[styles.text, { color: colors.upText }]} numberOfLines={1}>
          ⚡ Sell All
        </Text>
      ) : (
        <Text
          style={[styles.text, { color: pnl.isUp ? colors.upText : colors.downText }]}
          numberOfLines={1}
        >
          {pnl.isUp ? '▲' : '▼'} {formatSignedUsd(pnl.amount)}
        </Text>
      )}
    </Animated.View>
  );

  if (!isInteractive) {
    return content;
  }

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isSubmitting}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Position profit: ${formatSignedUsd(pnl.amount)}. Fast double tap to sell 100% of available ${baseCurrency} at current price.`}
      accessibilityState={{ disabled: isSubmitting }}
    >
      {content}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      minHeight: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    text: {
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
  }),
);
