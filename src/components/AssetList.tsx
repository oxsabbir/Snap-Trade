import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssetRow, type AssetScope } from '@/components/AssetRow';
import { EyeIcon } from '@/components/Icons';
import type { Holding, WalletKind } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';

/** Below this USD value a holding is leftover dust rather than a position. */
const DUST_USD = 1;

const SCOPES: { key: AssetScope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'funding', label: 'Funding' },
  { key: 'trading', label: 'Trading' },
];

type Props = {
  holdings: Holding[];
};

export function AssetList({ holdings }: Props) {
  const [scope, setScope] = useState<AssetScope>('all');
  const [hideDust, setHideDust] = useState(false);

  const scoped = useMemo(
    () => (scope === 'all' ? holdings : holdings.filter((h) => h[scope] !== null)),
    [holdings, scope]
  );

  const visible = useMemo(() => {
    if (!hideDust) return scoped;
    return scoped.filter((holding) => {
      // A zero value on an unpriceable currency means "unknown", not "worthless", so
      // those rows are always kept. Only real, priced dust gets hidden.
      if (holding.price <= 0) return true;
      const value = scope === 'all' ? holding.value : (holding[scope]?.value ?? 0);
      return value >= DUST_USD;
    });
  }, [scoped, hideDust, scope]);

  const hiddenCount = scoped.length - visible.length;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>Assets</Text>

        <View style={styles.headerActions}>
          <Text style={styles.count}>
            {hideDust && hiddenCount > 0
              ? `${visible.length} of ${scoped.length}`
              : `${scoped.length} ${scoped.length === 1 ? 'holding' : 'holdings'}`}
          </Text>
          <Pressable
            onPress={() => setHideDust((value) => !value)}
            style={[styles.dustToggle, hideDust && styles.dustToggleOn]}
            accessibilityRole="switch"
            accessibilityState={{ checked: hideDust }}
            accessibilityLabel={`Hide holdings under $${DUST_USD}`}
          >
            <EyeIcon size={14} color={hideDust ? colors.accent : colors.textFaint} />
            <Text style={[styles.dustText, hideDust && styles.dustTextOn]}>Hide &lt; ${DUST_USD}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.chips} accessibilityRole="tablist">
        {SCOPES.map((option) => {
          const active = scope === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => setScope(option.key)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {visible.length === 0 ? (
        <Text style={styles.empty}>
          {emptyCopy(holdings.length, scope, hideDust, hiddenCount)}
        </Text>
      ) : (
        <View style={styles.body}>
          {visible.map((holding) => (
            <AssetRow key={holding.currency} holding={holding} scope={scope} />
          ))}
        </View>
      )}
    </View>
  );
}

function emptyCopy(total: number, scope: AssetScope, hideDust: boolean, hiddenCount: number): string {
  if (total === 0) return 'No balances yet. Add funds to your main wallet to get started.';
  if (scope !== 'all') {
    const label: Record<WalletKind, string> = { funding: 'main wallet', trading: 'trading wallets' };
    return `Nothing held in your ${label[scope]}.`;
  }
  if (hideDust) {
    return hiddenCount > 0
      ? `Every holding is worth less than $${DUST_USD}.`
      : 'No holdings match this filter.';
  }
  return 'No holdings to show.';
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  count: {
    color: colors.textFaint,
    fontSize: 11,
  },
  dustToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dustToggleOn: {
    borderColor: 'rgba(35,175,137,0.4)',
    backgroundColor: 'rgba(35,175,137,0.1)',
  },
  dustText: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
  },
  dustTextOn: {
    color: colors.accent,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: 'rgba(35,175,137,0.14)',
    borderColor: 'rgba(35,175,137,0.4)',
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.accent,
  },
  body: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  empty: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
});
