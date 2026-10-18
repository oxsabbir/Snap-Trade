import {
  memo,
  useCallback,
  useRef,
  useState } from 'react';
import { Pressable, View } from '@/components/AppLayout';
import { StyleSheet, type NativeSyntheticEvent, type TextInput as NativeTextInput, type TextInputSubmitEditingEventData } from 'react-native';
import { Text, TextInput } from '@/components/AppText';

import { Avatar } from '@/components/Avatar';
import { EyeIcon, EyeOffIcon } from '@/components/Icons';
import type { Portfolio } from '@/lib/kucoin/account';
import type { AccountInfo } from '@/lib/kucoin/types';
import { radius, spacing } from '@/theme';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';
import { formatPrice, formatTime } from '@/utils/format';

type Props = {
  displayName: string;
  /** Omit to render the name as static text (e.g. when it edits a list owned elsewhere). */
  onRename?: (name: string) => void;
  accountInfo: AccountInfo | null;
  portfolio: Portfolio;
  lastUpdated: number | null;
};

const MASK = '••••••';

function ProfileCardComponent({ displayName, onRename, accountInfo, portfolio, lastUpdated }: Props) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const [isEditing, setIsEditing] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const inputRef = useRef<NativeTextInput>(null);

  const commit = useCallback(() => {
    onRename?.(draft);
    setIsEditing(false);
  }, [draft, onRename]);

  const handleSubmit = useCallback(
    (event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      event.preventDefault?.();
      commit();
      inputRef.current?.blur();
    },
    [commit]
  );

  const beginEdit = useCallback(() => {
    setDraft(displayName);
    setIsEditing(true);
  }, [displayName]);

  const toggleHidden = useCallback(() => setIsHidden((value) => !value), []);

  // One mask for every figure so the total and both wallet tiles always agree.
  const money = useCallback(
    (value: number) => (isHidden ? MASK : `$${formatPrice(value, 2)}`),
    [isHidden]
  );

  return (
    <View style={styles.card}>
      <View style={styles.accentBar} />

      <View style={styles.topRow}>
        <Avatar name={displayName} size={46} />

        <View style={styles.identityText}>
          <View style={styles.nameRow}>
            {isEditing ? (
              <TextInput
                ref={inputRef}
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={handleSubmit}
                onBlur={commit}
                autoFocus
                returnKeyType="done"
                maxLength={24}
                selectTextOnFocus
                style={styles.nameInput}
                placeholder="Display name"
                placeholderTextColor={colors.textFaint}
                keyboardAppearance={scheme === 'dark' ? 'dark' : 'light'}
                accessibilityLabel="Display name"
              />
            ) : onRename ? (
              <Pressable onPress={beginEdit} hitSlop={8} accessibilityRole="button">
                <Text style={styles.name} numberOfLines={1}>
                  {displayName}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
            )}

            {accountInfo ? (
              <View style={styles.vipPill}>
                <Text style={styles.vipText}>VIP {accountInfo.level}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.subtitle} numberOfLines={1}>
            {accountInfo && accountInfo.subQuantity > 0
              ? `${accountInfo.subQuantity} sub-account${accountInfo.subQuantity === 1 ? '' : 's'}`
              : 'KuCoin spot'}
          </Text>
        </View>

        <Pressable
          onPress={toggleHidden}
          hitSlop={10}
          style={styles.eyeButton}
          accessibilityRole="button"
          accessibilityLabel={isHidden ? 'Show balances' : 'Hide balances'}
          accessibilityState={{ selected: isHidden }}
        >
          {isHidden ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </Pressable>
      </View>

      <Text style={styles.totalLabel}>Total value</Text>
      <Text
        style={styles.totalValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        accessibilityLabel={isHidden ? 'Balance hidden' : undefined}
      >
        {money(portfolio.total)}
      </Text>

      <View style={styles.walletRow}>
        <WalletPill
          label="Funding"
          amount={money(portfolio.funding.total)}
          count={portfolio.funding.assets.length}
        />
        <WalletPill
          label="Trading"
          amount={money(portfolio.trading.total)}
          count={portfolio.trading.assets.length}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {lastUpdated ? `Updated ${formatTime(lastUpdated)}` : 'Not synced yet'}
        </Text>
        {portfolio.onHold > 0 ? (
          <Text style={[styles.footerText, styles.footerStrong]}>
            {money(portfolio.onHold)} in open orders
          </Text>
        ) : null}
        {portfolio.unpricedCount > 0 ? (
          <Text style={[styles.footerText, styles.footerWarn]}>
            {portfolio.unpricedCount} asset{portfolio.unpricedCount === 1 ? '' : 's'} could not be priced
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function WalletPill({ label, amount, count }: { label: string; amount: string; count: number }) {
  const styles = useStyles();
  return (
    <View style={styles.pill}>
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={styles.pillAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {amount}
      </Text>
      <Text style={styles.pillCount}>
        {count === 1 ? '1 asset' : `${count} assets`}
      </Text>
    </View>
  );
}

export const ProfileCard = memo(ProfileCardComponent);

const useStyles = createThemedStyles((colors) => StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  accentBar: {
    position: 'absolute',
    top: 0,
    left: spacing.lg,
    width: 40,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  identityText: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  nameInput: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  vipPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.upFill,
  },
  vipText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: colors.textFaint,
    fontSize: 12,
  },
  eyeButton: {
    padding: spacing.xs,
  },
  totalLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  totalValue: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  walletRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  pill: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  pillLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pillAmount: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  pillCount: {
    color: colors.textFaint,
    fontSize: 11,
  },
  footer: {
    marginTop: spacing.lg,
    gap: 3,
  },
  footerText: {
    color: colors.textFaint,
    fontSize: 11,
  },
  footerStrong: {
    color: colors.textMuted,
  },
  footerWarn: {
    color: colors.warning,
  },
}));
