import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CoinDetail } from '@/components/CoinDetail';
import { useActiveCoin } from '@/state/activeCoin';
import { colors, radius, spacing } from '@/theme';

export default function TradeScreen() {
  const coin = useActiveCoin();

  if (!coin) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No coin selected</Text>
        <Text style={styles.emptyBody}>Pick a pair from Markets to load its chart here.</Text>
        <Pressable
          onPress={() => router.navigate('/(tabs)')}
          style={styles.cta}
          accessibilityRole="button"
          accessibilityLabel="Browse markets"
        >
          <Text style={styles.ctaText}>Browse markets</Text>
        </Pressable>
      </View>
    );
  }

  return <CoinDetail symbol={coin.symbol} name={coin.name} decimals={coin.decimals} />;
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  cta: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 38,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  ctaText: {
    color: '#06231C',
    fontSize: 13,
    fontWeight: '700',
  },
});
