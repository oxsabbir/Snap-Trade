import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CoinAvatar } from '@/components/CoinAvatar';
import { StarIcon } from '@/components/Icons';
import { RangeBar } from '@/components/RangeBar';
import type { SpotMarket } from '@/lib/kucoin/types';
import { colors, spacing } from '@/theme';
import { formatCompact, formatPercent, formatPrice } from '@/utils/format';

type Props = {
  market: SpotMarket;
  isFavorite: boolean;
  onToggleFavorite: (symbol: string) => void;
};

function SpotRowComponent({ market, isFavorite, onToggleFavorite }: Props) {
  const isUp = market.changePercent >= 0;
  const changeColor = isUp ? colors.up : colors.down;
  const volume = `Vol ${formatCompact(market.quoteVolume)} ${market.quote}`;
  const subtitle = market.baseName !== market.base ? `${market.baseName} · ${volume}` : volume;

  return (
    <View style={styles.row}>
      <CoinAvatar symbol={market.base} />

      <View style={styles.identity}>
        <Text style={styles.symbol} numberOfLines={1}>
          {market.symbol}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.priceBlock}>
        <Text style={styles.price} numberOfLines={1}>
          {formatPrice(market.last, market.priceDecimals)}
        </Text>
        <View style={[styles.changePill, { backgroundColor: isUp ? 'rgba(35,175,137,0.14)' : 'rgba(246,70,93,0.14)' }]}>
          <Text style={[styles.change, { color: changeColor }]}>
            {formatPercent(market.changePercent)}
          </Text>
        </View>
      </View>

      <RangeBar low={market.low} high={market.high} last={market.last} />

      <Pressable
        onPress={() => onToggleFavorite(market.symbol)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityState={{ selected: isFavorite }}
        accessibilityLabel={`Favorite ${market.symbol}`}
        style={styles.star}
      >
        <StarIcon filled={isFavorite} color={isFavorite ? colors.warning : colors.textFaint} />
      </Pressable>
    </View>
  );
}

export const SpotRow = memo(SpotRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  symbol: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.textFaint,
    fontSize: 11,
  },
  priceBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  price: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  changePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 64,
    alignItems: 'center',
  },
  change: {
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  star: {
    paddingLeft: 2,
  },
});
