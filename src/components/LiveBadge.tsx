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
 * While the feed is anything but live, a standalone icon-only reconnect button renders just
 * before the badge: tapping it drops the shared market connection *and* its cached
 * token/endpoint, then redials at once — the manual escape hatch for a session that looks
 * stuck, without waiting for the ladder.
 */
export function LiveBadge({ symbol }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const status = useTickerStatus(symbol);
  const isLive = status === 'live';

  return (
    <>
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
    </>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    /** Standalone icon-only pill; the auto margin pairs it with the badge at the right edge. */
    reconnect: {
      marginLeft: 'auto',
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
