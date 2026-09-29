import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AssetList } from '@/components/AssetList';
import { ConnectAccountForm } from '@/components/ConnectAccountForm';
import { AccountIcon } from '@/components/Icons';
import { ProfileCard } from '@/components/ProfileCard';
import { useAccount } from '@/hooks/useAccount';
import { useProfile } from '@/hooks/useProfile';
import { colors, radius, spacing } from '@/theme';

export default function AccountScreen() {
  const { status, portfolio, accountInfo, lastUpdated, error, connect, disconnect, refresh } = useAccount();
  const { displayName, setDisplayName } = useProfile();

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
        <ConnectAccountForm onSubmit={connect} />
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
              onPress={disconnect}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Disconnect account"
            >
              <Text style={styles.secondaryText}>Disconnect</Text>
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

          <AssetList holdings={portfolio.holdings} />

          <Pressable
            onPress={disconnect}
            style={styles.disconnect}
            accessibilityRole="button"
            accessibilityLabel="Disconnect account"
          >
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
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
    paddingHorizontal: spacing.lg,
    height: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  secondaryText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  disconnect: {
    alignItems: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
  },
  disconnectText: {
    color: colors.down,
    fontSize: 13,
    fontWeight: '600',
  },
});
