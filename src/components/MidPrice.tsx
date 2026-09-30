import { StyleSheet, Text, View } from 'react-native';

import { useTicker } from '@/state/ticker';
import { colors, spacing } from '@/theme';
import { formatPrice } from '@/utils/format';

/** Currencies worth one dollar, so the mid price can carry a fiat line without a rates source. */
const USD_STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDD']);

type Props = {
  symbol: string;
  /** Display precision for the pair's price step. */
  priceDecimals: number;
  quoteCurrency: string;
};

/**
 * The band's live price, and the flat-dollar line under it when the pair is quoted in a stable.
 *
 * This is the reason the book is not handed a `lastPrice` prop. That prop changed on every
 * tick, which defeated the book's own memoisation and re-rendered its whole structure — every
 * row wrapper, the depth bars, the aggregation controls — to change two text nodes. As a leaf
 * that subscribes to the price itself, the rows only see their own depth.
 *
 * The colour is tick-to-tick direction, not "since the candle opened": this is a mid-price
 * label, and the since-open reading belongs to the header, which has the bucket and derives
 * it there.
 */
export function MidPrice({ symbol, priceDecimals, quoteCurrency }: Props) {
  const { update, direction } = useTicker(symbol);
  const hasPrice = update !== null && Number.isFinite(update.price);
  const price = hasPrice ? update.price : null;
  const fiat = price !== null && USD_STABLES.has(quoteCurrency) ? price : null;

  return (
    <View style={styles.middle}>
      <Text
        style={[
          styles.price,
          { color: price === null ? colors.textMuted : direction === 'up' ? colors.up : colors.down },
        ]}
      >
        {price === null ? '—' : formatPrice(price, priceDecimals)}
      </Text>
      {fiat !== null ? <Text style={styles.fiat}>≈${formatPrice(fiat, 2)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  middle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  fiat: {
    color: colors.textFaint,
    fontSize: 9,
  },
});
