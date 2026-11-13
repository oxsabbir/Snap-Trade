import { Modal, Share, StyleSheet, Text as RNText } from 'react-native';
import { Pressable, View } from '@/components/AppLayout';
import { useState } from 'react';
import { Text } from '@/components/AppText';

import { ReconnectIcon } from '@/components/Icons';
import {
  isDebugFreezeActive,
  reconnectPublicSocket,
  setDebugFreeze,
} from '@/lib/kucoin/publicSocket';
import { clearSocketLogText, getSocketLogText } from '@/lib/kucoin/socketLog';
import { useTickerStatus } from '@/state/ticker';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';

/**
 * The socket debug tools — freeze (zombie simulation), copy logs, clear logs — live behind
 * this one bundle-time flag. Set `EXPO_PUBLIC_SOCKET_TOOLS=true` in the build (CI exports it
 * for the signal-inclusive APK); the lite build simply does not set it, and every reference
 * below compiles away behind the constant.
 */
const TOOLS_ENABLED = process.env.EXPO_PUBLIC_SOCKET_TOOLS === 'true';

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
 *
 * When the tools flag is set, a long-press on the dot opens the debug tools: freeze the feed
 * to simulate a dead route, copy the phase-timestamp log block, or clear it.
 */
export function LiveBadge({ symbol }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const status = useTickerStatus(symbol);
  const isLive = status === 'live';
  const [toolsOpen, setToolsOpen] = useState(false);
  const [frozen, setFrozen] = useState(isDebugFreezeActive());

  const toggleFreeze = () => {
    const next = !frozen;
    setDebugFreeze(next);
    setFrozen(next);
  };

  const copyLogs = () => {
    void Share.share({ message: getSocketLogText() }).catch(() => undefined);
  };

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
        {TOOLS_ENABLED ? (
          <Pressable
            onLongPress={() => setToolsOpen(true)}
            delayLongPress={400}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open socket debug tools"
          >
            <View
              style={[styles.dot, { backgroundColor: isLive ? colors.up : colors.textFaint }]}
            />
          </Pressable>
        ) : (
          <View
            style={[styles.dot, { backgroundColor: isLive ? colors.up : colors.textFaint }]}
          />
        )}
        <Text style={styles.text}>
          {isLive
            ? 'Live'
            : status === 'connecting'
              ? 'Connecting'
              : 'Reconnecting'}
        </Text>
      </View>

      {TOOLS_ENABLED ? (
        <Modal visible={toolsOpen} transparent animationType="fade" onRequestClose={() => setToolsOpen(false)}>
          <Pressable style={styles.scrim} onPress={() => setToolsOpen(false)}>
            <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
              <Text style={styles.sheetTitle}>Socket tools — {symbol}</Text>
              <Text style={styles.sheetHint}>
                Freeze simulates a dead route: frames are ignored for ~5s, then the watchdog
                force-closes and the reconnect ladder proves itself.
              </Text>
              <Pressable
                onPress={toggleFreeze}
                style={[styles.toolButton, frozen && styles.toolButtonActive]}
                accessibilityRole="button"
              >
                <RNText style={[styles.toolText, frozen && styles.toolTextActive]}>
                  {frozen ? 'Unfreeze feed' : 'Freeze feed (watchdog test)'}
                </RNText>
              </Pressable>
              <Pressable
                onPress={copyLogs}
                style={styles.toolButton}
                accessibilityRole="button"
              >
                <RNText style={styles.toolText}>Copy logs</RNText>
              </Pressable>
              <Pressable
                onPress={() => {
                  clearSocketLogText();
                  setToolsOpen(false);
                }}
                style={styles.toolButton}
                accessibilityRole="button"
              >
                <RNText style={styles.toolText}>Clear logs</RNText>
              </Pressable>
              <Pressable
                onPress={() => setToolsOpen(false)}
                style={styles.toolClose}
                accessibilityRole="button"
                accessibilityLabel="Close socket tools"
              >
                <RNText style={styles.toolText}>Close</RNText>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      ) : null}
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
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    sheet: {
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    sheetHint: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    toolButton: {
      minHeight: 40,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
    },
    toolButtonActive: {
      backgroundColor: colors.down,
    },
    toolText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    toolTextActive: {
      color: colors.onAccent,
    },
    toolClose: {
      minHeight: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
  }),
);
