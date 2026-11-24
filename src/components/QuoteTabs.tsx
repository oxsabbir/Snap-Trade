import { ScrollView, Pressable } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { StarIcon } from '@/components/Icons';
import { QUOTE_FILTERS, type QuoteFilter } from '@/lib/kucoin/market';
import { spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themedStyles';

export const FAVORITES_TAB = 'Favorites' as const;
export type TabValue = typeof FAVORITES_TAB | QuoteFilter;

type Props = {
  value: TabValue;
  onChange: (value: TabValue) => void;
  favoritesCount: number;
};

export function QuoteTabs({ value, onChange, favoritesCount }: Props) {
  const styles = useStyles();
  const tabs: TabValue[] = [FAVORITES_TAB, ...QUOTE_FILTERS];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {tabs.map((tab) => {
        const isActive = tab === value;
        const isFav = tab === FAVORITES_TAB;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            style={[styles.chip, isActive && styles.chipActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
          >
            {isFav ? (
              <StarIcon
                size={13}
                filled
                color={isActive ? '#FFFFFF' : '#F5A900'}
              />
            ) : null}
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
              {isFav && favoritesCount > 0 ? `${tab}  ${favoritesCount}` : tab}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = createThemedStyles((colors) => {
  const isDark = colors.bg === '#121212';
  return StyleSheet.create({
    content: {
      paddingHorizontal: spacing.lg,
      paddingVertical: 4,
      gap: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      height: 34,
      justifyContent: 'center',
      borderRadius: 17,
      backgroundColor: isDark ? colors.surfaceAlt : '#F2F3F6',
    },
    chipActive: {
      backgroundColor: '#00B982',
      shadowColor: '#00B982',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.28,
      shadowRadius: 6,
      elevation: 3,
    },
    chipText: {
      color: isDark ? colors.textMuted : '#4B556B',
      fontSize: 13,
      fontWeight: '600',
    },
    chipTextActive: {
      color: '#FFFFFF',
    },
  });
});
