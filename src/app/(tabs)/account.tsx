import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssetList } from '@/components/AssetList';
import { AccountIcon } from '@/components/Icons';
import { ProfileCard } from '@/components/ProfileCard';
import { useAccount } from '@/hooks/useAccount';
import { useProfile } from '@/hooks/useProfile';
import { useApiCredentials, type OnboardingEntry } from '@/state/apiCredentials';
import { colors, radius, spacing } from '@/theme';
import { useState } from 'react';

function maskApiKey(apiKey: string | null): string {
  if (!apiKey || apiKey.length < 9) return '••••••';
  return `${apiKey.slice(0, 4)}••••••${apiKey.slice(-4)}`;
}

export default function AccountScreen() {
  const { status, portfolio, accountInfo, lastUpdated, error, refresh } = useAccount();
  const { displayName, setDisplayName } = useProfile();
  const { apiKey, disconnect } = useApiCredentials();
  const [accountAction, setAccountAction] = useState<OnboardingEntry | null>(null);
  const [accountActionError, setAccountActionError] = useState<string | null>(null);

  const leaveAccount = async (entry: OnboardingEntry) => {
    setAccountActionError(null);
    setAccountAction(entry);
    try {
      await disconnect(entry);
    } catch {
      setAccountActionError('Could not clear the saved key securely. Try again.');
      setAccountAction(null);
    }
  };

  const isBusy = status === 'loading' && portfolio.assets.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Account</Text>
        {isBusy ? <ActivityIndicator color={colors.accent} /> : null}
      </View>

      {status === 'loading' && portfolio.assets.length === 0 ? (
        <ActivityIndicator style={styles.centered} color={colors.accent} />
      ) : status === 'disconnected' ? (
        <ActivityIndicator style={styles.centered} color={colors.accent} />
      ) : status === 'error' && portfolio.assets.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.cardIcon}>
            <AccountIcon size={26} color={colors.down} />
          </View>
          <Text style={styles.cardTitle}>Could not load balances</Text>
          <Text style={styles.cardBody}>{error}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={refresh}
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry loading balances"
            >
              <Text style={styles.primaryText}>Retry</Text>
            </Pressable>
            <Pressable
              onPress={() => void leaveAccount('setup')}
              disabled={accountAction !== null}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Switch account"
            >
              <Text style={styles.secondaryText}>Switch</Text>
            </Pressable>
            <Pressable
              onPress={() => void leaveAccount('welcome')}
              disabled={accountAction !== null}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Text style={styles.secondaryText}>Log out</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          <ProfileCard
            displayName={displayName}
            onRename={setDisplayName}
            accountInfo={accountInfo}
            portfolio={portfolio}
            lastUpdated={lastUpdated}
          />

          <View style={styles.connection}>
            <Text style={styles.connectionLabel}>CONNECTED API KEY</Text>
            <Text style={styles.apiKey} selectable={false}>
              {maskApiKey(apiKey)}
            </Text>
            <Pressable
              onPress={() => void leaveAccount('setup')}
              disabled={accountAction !== null}
              style={[styles.switchButton, accountAction !== null && styles.actionDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Switch account"
            >
              <Text style={styles.switchButtonText}>
                {accountAction === 'setup' ? 'Switching…' : 'Switch account'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void leaveAccount('welcome')}
              disabled={accountAction !== null}
              style={[styles.logoutButton, accountAction !== null && styles.actionDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Text style={styles.logoutText}>
                {accountAction === 'welcome' ? 'Logging out…' : 'Log out'}
              </Text>
            </Pressable>
            {accountActionError ? (
              <Text style={styles.actionError} accessibilityRole="alert">
                {accountActionError}
              </Text>
            ) : null}
          </View>

          <AssetList holdings={portfolio.holdings} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  centered: {
    marginTop: spacing.xl,
  },
  card: {
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  primaryButton: {
    paddingHorizontal: spacing.lg,
    height: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  primaryText: {
    color: '#06231C',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingHorizontal: spacing.md,
    height: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  secondaryText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  connection: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    paddingTop: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  connectionLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
  },
  apiKey: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  switchButton: {
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginTop: spacing.xs,
  },
  switchButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  logoutButton: {
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: {
    color: colors.down,
    fontSize: 13,
    fontWeight: '600',
  },
  actionDisabled: {
    opacity: 0.45,
  },
  actionError: {
    color: colors.down,
    fontSize: 12,
    lineHeight: 17,
  },
});
