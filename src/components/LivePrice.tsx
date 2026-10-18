import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { deriveQuote } from '@/lib/quote';
import { useTicker } from '@/state/ticker';
import { createThemedStyles } from '@/theme/themedStyles';
import { useTheme } from '@/theme/ThemeProvider';
import { formatPercent, formatPrice } from '@/utils/format';

type Props = {
  symbol: string;
  /**
   * The current bucket's open, for the change pill. Undefined while history for the selected
   * series is still loading, which is reported as "no change" rather than a wrong number — see
   * `deriveQuote`. Changing timeframe leaves this undefined for a moment while the candles
   * refetch, so the price must not blank out with it.
   */
  bucketOpen?: number;
  /** The last candle's close, shown until the socket's first tick lands. */
  fallbackPrice?: number;
  decimals?: number;
};

/**
 * The header's price and change pill.
 *
 * A leaf that subscribes to the price itself. It used to read a value from `CoinDetail`'s
 * state several components above it, so a tick re-rendered the whole header — and, because
 * the value travelled down to the order book and the order form, so did those too. Nothing
 * above this component changes when the price does.
 */
export function LivePrice({ symbol, bucketOpen, fallbackPrice, decimals }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { update } = useTicker(symbol);
  const quote = deriveQuote(update?.price ?? fallbackPrice, bucketOpen);
  if (!quote) return null;

  return (
    <>
      <Text style={styles.price}>{formatPrice(quote.price, decimals)}</Text>
      {quote.change !== null ? (
        <View
          style={[
            styles.changePill,
            { backgroundColor: quote.isUp ? colors.upFill : colors.downFill },
          ]}
        >
          <Text style={[styles.change, { color: quote.isUp ? colors.upText : colors.downText }]}>
            {formatPercent(quote.change)}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    price: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    changePill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
    },
    change: {
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
  }),
);
