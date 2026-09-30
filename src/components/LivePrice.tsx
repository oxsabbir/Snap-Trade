import { StyleSheet, Text, View } from 'react-native';

import { deriveQuote } from '@/lib/quote';
import { useTicker } from '@/state/ticker';
import { colors } from '@/theme';
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
            { backgroundColor: quote.isUp ? 'rgba(35,175,137,0.14)' : 'rgba(246,70,93,0.14)' },
          ]}
        >
          <Text style={[styles.change, { color: quote.isUp ? colors.up : colors.down }]}>
            {formatPercent(quote.change)}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  price: {
    color: colors.text,
    fontSize: 30,
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
});
