import { ScrollView, Pressable, StyleSheet, Text } from 'react-native';

import { QUOTE_FILTERS, type QuoteFilter } from '@/lib/kucoin/market';
import { colors, radius, spacing } from '@/theme';

export const FAVORITES_TAB = 'Favorites' as const;
export type TabValue = typeof FAVORITES_TAB | QuoteFilter;

type Props = {
  value: TabValue;
  onChange: (value: TabValue) => void;
  favoritesCount: number;
};

export function QuoteTabs({ value, onChange, favoritesCount }: Props) {
  const tabs: TabValue[] = [FAVORITES_TAB, ...QUOTE_FILTERS];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {tabs.map((tab) => {
        const isActive = tab === value;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            style={[styles.chip, isActive && styles.chipActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
              {tab === FAVORITES_TAB && favoritesCount > 0 ? `${tab} ${favoritesCount}` : tab}
            </Text>
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
