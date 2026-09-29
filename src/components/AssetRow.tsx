import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CoinAvatar } from '@/components/CoinAvatar';
import type { Holding, WalletKind } from '@/lib/kucoin/types';
import { colors, spacing } from '@/theme';
import { formatAmount, formatPrice } from '@/utils/format';

/** `all` shows the rolled-up row; a wallet kind shows only that wallet's slice. */
export type AssetScope = 'all' | WalletKind;

const WALLET_HINT: Record<WalletKind, string> = {
  funding: 'Your main wallet',
  trading: 'Available to trade',
};

type Props = {
  holding: Holding;
  scope: AssetScope;
};

function AssetRowComponent({ holding, scope }: Props) {
  const slice = scope === 'all' ? null : holding[scope];
  const balance = slice ? slice.balance : holding.balance;
  const value = slice ? slice.value : holding.value;
  const holds = slice ? slice.holds : holding.holds;

  // A row only earns the split treatment when the currency is genuinely in both
  // wallets, and only in the rolled-up view. Narrowed here so nothing below needs
  // a non-null assertion.
  const { funding, trading } = holding;
  let fundingShare = 1;
  let splitText: string | null = null;

  if (scope === 'all' && funding && trading) {
    const combined = funding.value + trading.value;
    fundingShare = combined > 0 ? funding.value / combined : 1;
    splitText = `${formatAmount(funding.balance)} funding · ${formatAmount(trading.balance)} trading`;
  }

  let subtitle: string;
  if (splitText) {
    subtitle = holds > 0 ? `${splitText} · ${formatAmount(holds)} on hold` : splitText;
  } else if (scope !== 'all') {
    subtitle = holds > 0 ? `${WALLET_HINT[scope]} · ${formatAmount(holds)} on hold` : WALLET_HINT[scope];
  } else if (holding.price <= 0) {
    subtitle = 'No priceable pair';
  } else if (holds > 0) {
    subtitle = `${formatAmount(holds)} on hold · ≈ $${formatPrice(holding.price)}`;
  } else {
    subtitle = `≈ $${formatPrice(holding.price)}`;
  }

  return (
    <View style={styles.row}>
      <CoinAvatar symbol={holding.currency} />

      <View style={styles.identity}>
        <Text style={styles.currency} numberOfLines={1}>
          {holding.currency}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
        {splitText ? (
          <View
            style={styles.splitTrack}
            accessibilityRole="image"
            accessibilityLabel="Split between funding and trading"
          >
            <View style={[styles.splitSegment, { flex: fundingShare, backgroundColor: colors.accent }]} />
            <View style={[styles.splitSegment, { flex: 1 - fundingShare, backgroundColor: colors.accentSoft }]} />
          </View>
        ) : null}
      </View>

      <View style={styles.valueBlock}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {formatAmount(balance)}
        </Text>
        <Text style={styles.value} numberOfLines={1}>
          {holding.price > 0 ? `$${formatPrice(value, 2)}` : '—'}
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
    gap: 3,
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
  splitTrack: {
    flexDirection: 'row',
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 3,
    gap: 1.5,
  },
  splitSegment: {
    height: 3,
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
