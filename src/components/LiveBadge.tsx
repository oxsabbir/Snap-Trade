import { Pressable, View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { ReconnectIcon } from '@/components/Icons';
import { reconnectPublicSocket } from '@/lib/kucoin/publicSocket';
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
 *
 * The pair is right-aligned: the reconnect button (icon only, while the feed is anything but
 * live) sits immediately before the badge inside one trailing group, so the badge's position
 * never shifts when the button appears or disappears — tapping it drops the shared market
 * connection *and* its cached token/endpoint, then redials at once.
 */
export function LiveBadge({ symbol }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const status = useTickerStatus(symbol);
  const isLive = status === 'live';

  return (
    <View style={styles.trailing}>
      {!isLive ? (
        <Pressable
          onPress={reconnectPublicSocket}
          hitSlop={8}
          style={styles.reconnect}
          accessibilityRole="button"
          accessibilityLabel="Reconnect market feed"
        >
          <ReconnectIcon size={12} color={colors.textMuted} />
        </Pressable>
      ) : null}
      <View style={styles.badge}>
        <View
          style={[styles.dot, { backgroundColor: isLive ? colors.up : colors.textFaint }]}
        />
        <Text style={styles.text}>
          {isLive
            ? 'Live'
            : status === 'connecting'
              ? 'Connecting'
              : 'Reconnecting'}
        </Text>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    /** The button + badge travel as one right-aligned unit so neither moves the other's spot. */
    trailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginLeft: 'auto',
    },
    /** Standalone icon-only pill; the auto margin pairs it with the badge at the right edge. */
    reconnect: {
      paddingHorizontal: spacing.xs,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
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
