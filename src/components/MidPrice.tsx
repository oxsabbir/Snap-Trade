import { Pressable } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { useTicker } from '@/state/ticker';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';
import { formatPrice } from '@/utils/format';

/** Currencies worth one dollar, so the mid price can carry a fiat line without a rates source. */
const USD_STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDD']);

type Props = {
  symbol: string;
  /** Display precision for the pair's price step. */
  priceDecimals: number;
  quoteCurrency: string;
  /**
   * Fills the trade form's Price field with the live mid when the band is tapped, the same way a
   * tap on a depth row does. The value is a plain decimal at the pair's tick precision, so it drops
   * straight into the form's numeric field without the thousands separators `formatPrice` adds.
   */
  onPriceSelect?: (price: string) => void;
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
export function MidPrice({ symbol, priceDecimals, quoteCurrency, onPriceSelect }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { update, direction } = useTicker(symbol);
  const hasPrice = update !== null && Number.isFinite(update.price);
  const price = hasPrice ? update.price : null;
  const fiat = price !== null && USD_STABLES.has(quoteCurrency) ? price : null;
  const tappable = price !== null && onPriceSelect !== undefined;
  return (
    <Pressable
      onPress={tappable ? () => onPriceSelect(price.toFixed(priceDecimals)) : undefined}
      disabled={!tappable}
      style={styles.middle}
      accessibilityRole={tappable ? 'button' : undefined}
      accessibilityLabel={tappable ? `Use price ${formatPrice(price, priceDecimals)}` : undefined}
    >
      <Text
        style={[
          styles.price,
          { color: price === null ? colors.textMuted : direction === 'up' ? colors.upText : colors.downText },
        ]}
      >
        {price === null ? '—' : formatPrice(price, priceDecimals)}
      </Text>
      {fiat !== null ? <Text style={styles.fiat}>≈${formatPrice(fiat, 2)}</Text> : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
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
  }),
);
