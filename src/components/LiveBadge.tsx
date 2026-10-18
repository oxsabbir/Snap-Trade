import { View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { useTickerStatus } from '@/state/ticker';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';

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
  const { colors } = useTheme();
  const styles = useStyles();
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

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
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
  }),
);
