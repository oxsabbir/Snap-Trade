import { memo } from 'react';
import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { CoinAvatar } from '@/components/CoinAvatar';
import type { Holding, WalletKind } from '@/lib/kucoin/types';
import { radius, spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themedStyles';
import { formatAmount, formatPrice } from '@/utils/format';
import { useBalanceVisibility } from '@/state/balanceVisibility';

export type AssetScope = 'all' | WalletKind;

const MASK = '••••••';

type Props = {
  holding: Holding;
  scope: AssetScope;
};

function AssetRowComponent({ holding, scope }: Props) {
  const { balancesVisible } = useBalanceVisibility();
  const styles = useStyles();

  const slice = scope === 'all' ? null : holding[scope];
  const balance = slice ? slice.balance : holding.balance;
  const value = slice ? slice.value : holding.value;
  const holds = slice ? slice.holds : holding.holds;

  const { funding, trading } = holding;
  const hasFunding = Boolean(funding && funding.balance > 0);
  const hasTrading = Boolean(trading && trading.balance > 0);
  const isSplit = scope === 'all' && hasFunding && hasTrading;
  const isOnlyFunding = scope === 'all' && hasFunding && !hasTrading;
  const isOnlyTrading = scope === 'all' && hasTrading && !hasFunding;

  return (
    <View style={styles.card}>
      {/* Top Main Row */}
      <View style={styles.mainRow}>
        <CoinAvatar symbol={holding.currency} size={38} />

        <View style={styles.identity}>
          <View style={styles.currencyRow}>
            <Text style={styles.currency} numberOfLines={1}>
              {holding.currency}
            </Text>
            {isOnlyTrading ? (
              <View style={[styles.badge, styles.badgeTrading]}>
                <Text style={styles.badgeTradingText}>Trading</Text>
              </View>
            ) : isOnlyFunding ? (
              <View style={[styles.badge, styles.badgeFunding]}>
                <Text style={styles.badgeFundingText}>Funding</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.price} numberOfLines={1}>
            {holding.price > 0
              ? balancesVisible
                ? `≈ $${formatPrice(holding.price)}`
                : MASK
              : 'No pair'}
          </Text>
        </View>

        <View style={styles.valueBlock}>
          <Text style={styles.value} numberOfLines={1}>
            {holding.price > 0 ? (balancesVisible ? `$${formatPrice(value, 2)}` : MASK) : '—'}
          </Text>
          <Text style={styles.amount} numberOfLines={1}>
            {balancesVisible ? `${formatAmount(balance)} ${holding.currency}` : MASK}
          </Text>
        </View>
      </View>

      {/* Dedicated Wallet Breakdown: Rendered cleanly when balance is split across wallets or has holds */}
      {scope === 'all' && (isSplit || holds > 0) ? (
        <View style={styles.breakdown}>
          <View style={styles.breakdownList}>
            {hasTrading ? (
              <View style={styles.breakdownItem}>
                <Text style={styles.breakdownLabel}>Trading</Text>
                <Text style={styles.breakdownValue} numberOfLines={1}>
                  {balancesVisible ? formatAmount(trading!.balance) : MASK}
                </Text>
              </View>
            ) : null}

            {hasFunding ? (
              <View style={styles.breakdownItem}>
                <Text style={styles.breakdownLabel}>Funding</Text>
                <Text style={styles.breakdownValue} numberOfLines={1}>
                  {balancesVisible ? formatAmount(funding!.balance) : MASK}
                </Text>
              </View>
            ) : null}

            {holds > 0 ? (
              <View style={[styles.breakdownItem, styles.breakdownItemLocked]}>
                <Text style={styles.lockedLabel}>In Orders</Text>
                <Text style={styles.lockedValue} numberOfLines={1}>
                  {balancesVisible ? formatAmount(holds) : MASK}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Filtered view (Trading or Funding tab selected) with active holds */}
      {scope !== 'all' && holds > 0 ? (
        <View style={styles.breakdown}>
          <View style={styles.breakdownList}>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownLabel}>Available</Text>
              <Text style={styles.breakdownValue} numberOfLines={1}>
                {balancesVisible ? formatAmount(slice?.available ?? 0) : MASK}
              </Text>
            </View>
            <View style={[styles.breakdownItem, styles.breakdownItemLocked]}>
              <Text style={styles.lockedLabel}>In Orders</Text>
              <Text style={styles.lockedValue} numberOfLines={1}>
                {balancesVisible ? formatAmount(holds) : MASK}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export const AssetRow = memo(AssetRowComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
    },
    mainRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    identity: {
      flex: 1,
      gap: 3,
    },
    currencyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    currency: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 1.5,
      borderRadius: 4,
    },
    badgeTrading: {
      backgroundColor: colors.upFill,
    },
    badgeTradingText: {
      color: colors.upText,
      fontSize: 10,
      fontWeight: '700',
    },
    badgeFunding: {
      backgroundColor: colors.surfaceAlt,
    },
    badgeFundingText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
    },
    price: {
      color: colors.textFaint,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    valueBlock: {
      alignItems: 'flex-end',
      gap: 2,
    },
    value: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    amount: {
      color: colors.textMuted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    breakdown: {
      marginTop: spacing.sm,
      paddingTop: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    breakdownList: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingTop: 4,
    },
    breakdownItem: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 5,
      gap: 1,
    },
    breakdownItemLocked: {
      backgroundColor: colors.downFill,
    },
    breakdownLabel: {
      color: colors.textMuted,
      fontSize: 9,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    breakdownValue: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    lockedLabel: {
      color: colors.downText,
      fontSize: 9,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    lockedValue: {
      color: colors.downText,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
  })
);
