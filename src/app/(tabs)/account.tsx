import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountIcon } from '@/components/Icons';
import { AssetRow } from '@/components/AssetRow';
import { ConnectAccountForm } from '@/components/ConnectAccountForm';
import { useAccount } from '@/hooks/useAccount';
import { colors, radius, spacing } from '@/theme';
import { formatPrice } from '@/utils/format';

export default function AccountScreen() {
  const { status, assets, total, error, connect, disconnect, refresh } = useAccount();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Account</Text>
        {status === 'loading' && assets.length > 0 ? (
          <ActivityIndicator color={colors.accent} />
        ) : null}
      </View>

      {status === 'loading' && assets.length === 0 ? (
        <ActivityIndicator style={styles.centered} color={colors.accent} />
      ) : status === 'disconnected' ? (
        <ConnectAccountForm onSubmit={connect} />
      ) : status === 'error' && assets.length === 0 ? (
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
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>Total value</Text>
            <Text style={styles.totalValue}>${formatPrice(total, 2)}</Text>
            <Text style={styles.totalNote}>
              {assets.length === 1 ? '1 asset' : `${assets.length} assets`} · spot wallets
            </Text>
          </View>

          <Text style={styles.sectionLabel}>Assets</Text>
          {assets.map((asset) => (
            <AssetRow key={asset.currency} asset={asset} />
          ))}

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
  totalCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  totalLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  totalValue: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  totalNote: {
    color: colors.textFaint,
    fontSize: 12,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  disconnect: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  disconnectText: {
    color: colors.down,
    fontSize: 13,
    fontWeight: '600',
  },
});
