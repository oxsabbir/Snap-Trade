import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CandleChartIcon, LineChartIcon } from '@/components/Icons';
import type { ChartMode } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';

const MODES: { key: ChartMode; label: string }[] = [
  { key: 'line', label: 'Line' },
  { key: 'candle', label: 'Candle' },
];

type Props = {
  value: ChartMode;
  onChange: (mode: ChartMode) => void;
};

export function ChartModeToggle({ value, onChange }: Props) {
  return (
    <View style={styles.container}>
      {MODES.map((mode) => {
        const isActive = mode.key === value;
        const Icon = mode.key === 'line' ? LineChartIcon : CandleChartIcon;
        return (
          <Pressable
            key={mode.key}
            onPress={() => onChange(mode.key)}
            style={[styles.option, isActive && styles.optionActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Icon size={14} color={isActive ? colors.text : colors.textFaint} />
            <Text style={[styles.label, isActive && styles.labelActive]}>{mode.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  optionActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    color: colors.textFaint,
    fontSize: 12,
    fontWeight: '600',
  },
  labelActive: {
    color: colors.text,
  },
});
