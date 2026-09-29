import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FAVORITES_TAB, QuoteTabs, type TabValue } from '@/components/QuoteTabs';
import { PopularSearches } from '@/components/PopularSearches';
import { SearchBar } from '@/components/SearchBar';
import { SpotRow } from '@/components/SpotRow';
import { useSpotMarkets } from '@/hooks/useSpotMarkets';
import { searchMarkets, type QuoteFilter } from '@/lib/kucoin/market';
import { colors, spacing } from '@/theme';
import { formatTime } from '@/utils/format';

const POPULAR_COUNT = 10;

export default function MarketsScreen() {
  const { markets, isLoading, isRefreshing, error, lastUpdated, refresh } = useSpotMarkets();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabValue>('All');
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());

  const toggleFavorite = useCallback((symbol: string) => {
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }, []);

  const sortedMarkets = useMemo(
    () => [...markets].sort((a, b) => b.quoteVolume - a.quoteVolume),
    [markets]
  );

  const quoteFilter: QuoteFilter = tab === FAVORITES_TAB ? 'All' : (tab as QuoteFilter);
  const activeQuery = search.trim();

  const visibleMarkets = useMemo(() => {
    const source =
      tab === FAVORITES_TAB
        ? sortedMarkets.filter((market) => favorites.has(market.symbol))
        : sortedMarkets;
    return searchMarkets(source, quoteFilter, search);
  }, [favorites, quoteFilter, search, sortedMarkets, tab]);

  const popularSymbols = useMemo(() => {
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const market of sortedMarkets) {
      if (seen.has(market.base)) continue;
      seen.add(market.base);
      picked.push(market.base);
      if (picked.length === POPULAR_COUNT) break;
    }
    return picked;
  }, [sortedMarkets]);

  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Spot</Text>
          <Text style={styles.subtitle}>
            {isLoading ? 'Loading markets…' : `${visibleMarkets.length} pairs`}
            {lastUpdated ? ` · ${formatTime(lastUpdated)}` : ''}
          </Text>
        </View>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search coin, e.g. BTC" />
      </View>

      <View style={styles.tabs}>
        <QuoteTabs value={tab} onChange={setTab} favoritesCount={favorites.size} />
      </View>

      {activeQuery.length === 0 && !isLoading ? (
        <PopularSearches symbols={popularSymbols} onSelect={setSearch} />
      ) : null}

      <FlatList
        data={visibleMarkets}
        keyExtractor={(market) => market.symbol}
        renderItem={({ item }) => (
          <SpotRow
            market={item}
            isFavorite={favorites.has(item.symbol)}
            onToggleFavorite={toggleFavorite}
          />
        )}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={dismissKeyboard}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceAlt}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator style={styles.empty} color={colors.accent} />
          ) : (
            <EmptyState tab={tab} hasSearch={search.trim().length > 0} error={error} />
          )
        }
        ListFooterComponent={<View style={styles.footer} />}
        initialNumToRender={14}
        maxToRenderPerBatch={16}
        windowSize={9}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

function EmptyState({ tab, hasSearch, error }: { tab: TabValue; hasSearch: boolean; error: string | null }) {
  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Could not reach KuCoin</Text>
        <Text style={styles.emptyBody}>{error}</Text>
        <Text style={styles.emptyHint}>Pull down to retry.</Text>
      </View>
    );
  }

  if (tab === FAVORITES_TAB && !hasSearch) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No favorites yet</Text>
        <Text style={styles.emptyBody}>Tap the star on any pair to pin it here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No pairs found</Text>
      <Text style={styles.emptyBody}>Try a different coin or quote currency.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textFaint,
    fontSize: 12,
  },
  tabs: {
    paddingBottom: spacing.md,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  footer: {
    height: spacing.xl,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  emptyHint: {
    color: colors.textFaint,
    fontSize: 12,
  },
});
