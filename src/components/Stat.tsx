import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme';

type Props = {
  label: string;
  value: string;
  /** 2 lays the item out at half width inside a wrapping row, 1 fills the row. */
  columns?: 1 | 2;
  /** Optional secondary line, e.g. a contract address under a currency name. */
  hint?: string;
  tone?: 'default' | 'up' | 'down';
};

function StatComponent({ label, value, columns = 2, hint, tone = 'default' }: Props) {
  const valueColor = tone === 'up' ? colors.up : tone === 'down' ? colors.down : colors.text;

  return (
    <View style={[styles.stat, columns === 1 ? styles.full : styles.half]}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color: valueColor }]} numberOfLines={1} ellipsizeMode="middle">
        {value}
      </Text>
      {hint ? (
        <Text style={styles.statHint} numberOfLines={1} ellipsizeMode="middle">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export const Stat = memo(StatComponent);

const styles = StyleSheet.create({
  stat: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 3,
  },
  half: {
    width: '50%',
  },
  full: {
    width: '100%',
  },
  statLabel: {
    color: colors.textFaint,
    fontSize: 11,
  },
  statValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  statHint: {
    color: colors.textFaint,
    fontSize: 10,
  },
});
