import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  RefreshControl,
  type ListRenderItem,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useIsFocused } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  FAVORITES_TAB,
  QuoteTabs,
  type TabValue,
} from "@/components/QuoteTabs";
import { PopularSearches } from "@/components/PopularSearches";
import { RecentSearches } from "@/components/RecentSearches";
import { SearchBar } from "@/components/SearchBar";
import { SpotRow } from "@/components/SpotRow";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { useSpotMarkets } from "@/hooks/useSpotMarkets";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchMarkets, type QuoteFilter } from "@/lib/kucoin/market";
import type { SpotMarket } from "@/lib/kucoin/types";
import { colors, spacing } from "@/theme";
import { formatTime } from "@/utils/format";

const POPULAR_COUNT = 10;
/** Module level so the list always sees the same extractor and never rebuilds its key map. */
const keyExtractor = (market: SpotMarket) => market.symbol;
/** Stable fallback so an omitted `favorites` prop cannot hand the row callback a fresh Set each render. */
const NO_FAVORITES: ReadonlySet<string> = new Set<string>();

/**
 * How much of the list is allowed to exist as real mounted rows at once. The array still holds
 * every pair, because sorting and search need the full set, but only this much is handed to the
 * native view hierarchy.
 */
const INITIAL_ROWS = 20;
const ROWS_PER_BATCH = 20;

const MarketsList = memo(function MarketsList({
  visibleMarkets,
  keyExtractor,
  isLoading,
  isRefreshing,
  error,
  activeQuery,
  tab,
  refresh,
  onTabChange,
  favoritesCount,
  popularSymbols,
  onPopularSelect,
  favorites = NO_FAVORITES,
  toggleFavorite,
}: {
  visibleMarkets: SpotMarket[];
  keyExtractor: (item: SpotMarket) => string;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  activeQuery: string;
  tab: TabValue;
  refresh: () => void;
  onTabChange: (tab: TabValue) => void;
  favoritesCount: number;
  popularSymbols: string[];
  onPopularSelect: (symbol: string) => void;
  favorites?: ReadonlySet<string>;
  toggleFavorite: (symbol: string) => void;
}) {
  // Stable renderItem with isFavorite computed from passed favorites Set
  const renderRow = useCallback<ListRenderItem<SpotMarket>>(
    ({ item }) => (
      <SpotRow
        market={item}
        isFavorite={favorites.has(item.symbol)}
        onToggleFavorite={toggleFavorite}
      />
    ),
    [favorites, toggleFavorite],
  );

  return (
    <>
      <View style={styles.tabs}>
        <QuoteTabs value={tab} onChange={onTabChange} favoritesCount={favoritesCount} />
      </View>

      {activeQuery.length === 0 && !isLoading ? (
        <PopularSearches symbols={popularSymbols} onSelect={onPopularSelect} />
      ) : null}

      <FlatList
        data={visibleMarkets}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
            <EmptyState tab={tab} hasSearch={activeQuery.length > 0} error={error} />
          )
        }
        ListFooterComponent={<View style={styles.footer} />}
        initialNumToRender={INITIAL_ROWS}
        maxToRenderPerBatch={ROWS_PER_BATCH}
        windowSize={9}
        updateCellsBatchingPeriod={40}
      />
    </>
  );
});

export default function MarketsScreen() {
  const { markets, isLoading, isRefreshing, error, lastUpdated, refresh } =
    useSpotMarkets(useIsFocused());
  const {
    recents,
    add: addRecent,
    remove: removeRecent,
    clear: clearRecents,
  } = useRecentSearches();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabValue>("All");
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const interactingRef = useRef(false);

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
    [markets],
  );

  const quoteFilter: QuoteFilter =
    tab === FAVORITES_TAB ? "All" : (tab as QuoteFilter);
  // Debounce the search query to avoid re-filtering on every keystroke
  const activeQuery = useDebouncedValue(search.trim(), 300);

  const visibleMarkets = useMemo(() => {
    const source =
      tab === FAVORITES_TAB
        ? sortedMarkets.filter((market) => favorites.has(market.symbol))
        : sortedMarkets;
    return searchMarkets(source, quoteFilter, activeQuery);
  }, [favorites, quoteFilter, activeQuery, sortedMarkets, tab]);

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

  /* dismissed with keyboardDismissMode="on-drag" */

  const handleSearchFocus = useCallback(() => {
    interactingRef.current = false;
    setIsSearchFocused(true);
  }, []);

  const handleSearchBlur = useCallback(() => {
    if (interactingRef.current) return;
    setIsSearchFocused(false);
  }, []);

  const commitSearch = useCallback(
    (query: string) => {
      addRecent(query);
      setSearch(query);
      setIsSearchFocused(false);
      interactingRef.current = false;
      Keyboard.dismiss();
    },
    [addRecent],
  );

  const handleSubmit = useCallback(() => {
    commitSearch(search);
  }, [commitSearch, search]);

  const showSuggestions = isSearchFocused && activeQuery.length === 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Spot</Text>
          <Text style={styles.subtitle}>
            {isLoading ? "Loading markets…" : `${visibleMarkets.length} pairs`}
            {lastUpdated ? ` · ${formatTime(lastUpdated)}` : ""}
          </Text>
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          onSubmit={handleSubmit}
          placeholder="Search coin, e.g. BTC"
        />
      </View>

      {showSuggestions ? (
        <>
          <RecentSearches
            recents={recents}
            onSelect={commitSearch}
            onRemove={removeRecent}
            onClear={clearRecents}
            onInteract={() => {
              interactingRef.current = true;
            }}
          />
          <PopularSearches symbols={popularSymbols} onSelect={commitSearch} />
        </>
      ) : (
        <MarketsList
          visibleMarkets={visibleMarkets}
          keyExtractor={keyExtractor}
          isLoading={isLoading}
          isRefreshing={isRefreshing}
          error={error}
          activeQuery={activeQuery}
          tab={tab}
          refresh={refresh}
          onTabChange={setTab}
          favoritesCount={favorites.size}
          popularSymbols={popularSymbols}
          onPopularSelect={commitSearch}
          favorites={favorites}
          toggleFavorite={toggleFavorite}
        />
      )}
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

function EmptyState({
  tab,
  hasSearch,
  error,
}: {
  tab: TabValue;
  hasSearch: boolean;
  error: string | null;
}) {
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
        <Text style={styles.emptyBody}>
          Tap the star on any pair to pin it here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No pairs found</Text>
      <Text style={styles.emptyBody}>
        Try a different coin or quote currency.
      </Text>
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
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
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
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
  emptyHint: {
    color: colors.textFaint,
    fontSize: 12,
  },
});
