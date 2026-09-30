import { StyleSheet, Text, View } from 'react-native';

import { useTickerStatus } from '@/state/ticker';
import { colors, radius, spacing } from '@/theme';

type Props = {
  symbol: string;
};

/**
 * The connection state, as a dot and a word.
 *
 * Separate from `LivePrice` on purpose. This subscribes to the *status* alone, and the status
 * snapshot is a string, so an unchanged status compares equal and the badge does not re-render
 * on any of the five price ticks a second. Sharing one subscription with the price would have
 * put it back in that path.
 */
export function LiveBadge({ symbol }: Props) {
  const status = useTickerStatus(symbol);

  return (
    <View style={styles.badge}>
      <View
        style={[styles.dot, { backgroundColor: status === 'live' ? colors.up : colors.textFaint }]}
      />
      <Text style={styles.text}>
        {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
});
