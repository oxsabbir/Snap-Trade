import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { LINE_TIMEFRAME, TIMEFRAMES, type TimeframeOrLine } from '@/lib/kucoin/candles';
import { colors, radius, spacing } from '@/theme';

type Props = {
  value: string;
  onChange: (timeframe: TimeframeOrLine) => void;
};

export function TimeframeTabs({ value, onChange }: Props) {
  // Line first: it is the widest possible range, so it reads as the leftmost option.
  // The row is a horizontal ScrollView, so the extra chip costs nothing at narrow widths.
  const options: TimeframeOrLine[] = [LINE_TIMEFRAME, ...TIMEFRAMES];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {options.map((timeframe) => {
        const isActive = timeframe.key === value;
        return (
          <Pressable
            key={timeframe.key}
            onPress={() => onChange(timeframe)}
            style={[styles.chip, isActive && styles.chipActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{timeframe.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    height: 30,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: {
    backgroundColor: colors.accent,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#06231C',
  },
});
