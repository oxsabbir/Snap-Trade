import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CoinAvatar } from '@/components/CoinAvatar';
import type { PortfolioAsset } from '@/lib/kucoin/types';
import { colors, spacing } from '@/theme';
import { formatAmount, formatPrice } from '@/utils/format';

type Props = {
  asset: PortfolioAsset;
};

function AssetRowComponent({ asset }: Props) {
  const hasPrice = asset.price > 0;
  const subtitle = asset.holds > 0 ? `${formatAmount(asset.holds)} on hold` : `≈ $${formatPrice(asset.price)}`;

  return (
    <View style={styles.row}>
      <CoinAvatar symbol={asset.currency} />

      <View style={styles.identity}>
        <Text style={styles.currency} numberOfLines={1}>
          {asset.currency}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      <View style={styles.valueBlock}>
        <Text style={styles.amount} numberOfLines={1}>
          {formatAmount(asset.balance)}
        </Text>
        <Text style={styles.value} numberOfLines={1}>
          {hasPrice ? `$${formatPrice(asset.value, 2)}` : '—'}
        </Text>
      </View>
    </View>
  );
}

export const AssetRow = memo(AssetRowComponent);

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
  currency: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.textFaint,
    fontSize: 11,
  },
  valueBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  amount: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  value: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
