import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TrashIcon } from '@/components/Icons';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';

/** A stored pair (canonical symbol) plus the slash form shown on its card. */
export type RecentCoin = {
  symbol: string;
  label: string;
};

type Props = {
  items: RecentCoin[];
  onSelect: (item: RecentCoin) => void;
  onClear: () => void;
  onInteract?: () => void;
};

export function RecentSearches({ items, onSelect, onClear, onInteract }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Search History</Text>
        <Pressable
          onPress={onClear}
          hitSlop={10}
          style={styles.clearButton}
          accessibilityRole="button"
          accessibilityLabel="Clear search history"
        >
          <TrashIcon size={16} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.cards}
      >
        {items.map((item) => (
          <Pressable
            key={item.symbol}
            onPressIn={onInteract}
            onPress={() => onSelect(item)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.label}`}
          >
            <Text style={styles.cardText} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    container: {
      flexShrink: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    title: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    clearButton: {
      padding: 4,
    },
    cards: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    card: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    cardPressed: {
      opacity: 0.65,
    },
    cardText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
  }),
);
