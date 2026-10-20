import {
  memo } from 'react';
import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { CoinAvatar } from '@/components/CoinAvatar';
import type { Holding, WalletKind } from '@/lib/kucoin/types';
import { spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';
import { formatAmount, formatPrice } from '@/utils/format';
import { useBalanceVisibility } from '@/state/balanceVisibility';

/** `all` shows the rolled-up row; a wallet kind shows only that wallet's slice. */
export type AssetScope = 'all' | WalletKind;

const WALLET_HINT: Record<WalletKind, string> = {
  funding: 'Your main wallet',
  trading: 'Available to trade',
};
const MASK = '••••••';

type Props = {
  holding: Holding;
  scope: AssetScope;
};

function AssetRowComponent({ holding, scope }: Props) {
  const { colors } = useTheme();
  const { balancesVisible } = useBalanceVisibility();
  const styles = useStyles();
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
    splitText = balancesVisible
      ? `${formatAmount(funding.balance)} funding · ${formatAmount(trading.balance)} trading`
      : `${MASK} funding · ${MASK} trading`;
  }

  let subtitle: string;
  if (splitText) {
    subtitle = holds > 0 ? `${splitText} · ${balancesVisible ? formatAmount(holds) : MASK} on hold` : splitText;
  } else if (scope !== 'all') {
    subtitle = holds > 0 ? `${WALLET_HINT[scope]} · ${balancesVisible ? formatAmount(holds) : MASK} on hold` : WALLET_HINT[scope];
  } else if (holding.price <= 0) {
    subtitle = 'No priceable pair';
  } else if (holds > 0) {
    subtitle = `${balancesVisible ? formatAmount(holds) : MASK} on hold · ${balancesVisible ? `≈ $${formatPrice(holding.price)}` : MASK}`;
  } else {
    subtitle = balancesVisible ? `≈ $${formatPrice(holding.price)}` : MASK;
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
        {splitText && balancesVisible ? (
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
          {balancesVisible ? formatAmount(balance) : MASK}
        </Text>
        <Text style={styles.value} numberOfLines={1}>
          {holding.price > 0 ? (balancesVisible ? `$${formatPrice(value, 2)}` : MASK) : '—'}
        </Text>
      </View>
    </View>
  );
}

export const AssetRow = memo(AssetRowComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
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
  }),
);
