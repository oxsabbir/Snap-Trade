import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';

type Props = {
  symbols: string[];
  onSelect: (symbol: string) => void;
};

export function PopularSearches({ symbols, onSelect }: Props) {
  if (symbols.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Popular</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {symbols.map((symbol) => (
          <Pressable
            key={symbol}
            onPress={() => onSelect(symbol)}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={`Search ${symbol}`}
          >
            <Text style={styles.chipText}>{symbol}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.md,
  },
  label: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  chips: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    height: 30,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
