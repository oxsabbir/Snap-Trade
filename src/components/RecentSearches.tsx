import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ClockIcon, CloseIcon } from '@/components/Icons';
import { colors, spacing } from '@/theme';

type Props = {
  recents: string[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
  onInteract?: () => void;
};

export function RecentSearches({ recents, onSelect, onRemove, onClear, onInteract }: Props) {
  if (recents.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>Recent</Text>
        <Pressable
          onPress={onClear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear recent searches"
        >
          <Text style={styles.clear}>Clear</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {recents.map((query, index) => (
          <Pressable
            key={query}
            onPressIn={onInteract}
            onPress={() => onSelect(query)}
            style={[styles.row, index < recents.length - 1 && styles.rowDivided]}
            accessibilityRole="button"
            accessibilityLabel={`Search ${query}`}
          >
            <ClockIcon />
            <Text style={styles.query} numberOfLines={1}>
              {query}
            </Text>
            <Pressable
              onPress={() => onRemove(query)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${query} from recent searches`}
            >
              <CloseIcon size={14} />
            </Pressable>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  label: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  clear: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 44,
    paddingHorizontal: spacing.lg,
  },
  rowDivided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  query: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
});
