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
import { router, useIsFocused } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  FAVORITES_TAB,
  QuoteTabs,
  type TabValue,
} from "@/components/QuoteTabs";
import { PopularSearches } from "@/components/PopularSearches";
import { RecentSearches, type RecentCoin } from "@/components/RecentSearches";
import { SearchBar } from "@/components/SearchBar";
import { SpotRow } from "@/components/SpotRow";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { useSpotMarkets } from "@/hooks/useSpotMarkets";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchMarkets, type QuoteFilter } from "@/lib/kucoin/market";
import type { SpotMarket } from "@/lib/kucoin/types";
import { useSetActiveCoin } from "@/state/activeCoin";
import { colors, spacing } from "@/theme";
import { formatPairSymbol, formatTime } from "@/utils/format";

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

/** Resolves a stored pair back to its loaded market, tolerant of case differences. */
function findMarketBySymbol(markets: SpotMarket[], symbol: string): SpotMarket | undefined {
  const target = symbol.toUpperCase();
  return markets.find((market) => market.symbol.toUpperCase() === target);
}

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
  onOpenMarket,
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
  onOpenMarket: (symbol: string) => void;
}) {
  // Stable renderItem with isFavorite computed from passed favorites Set
  const renderRow = useCallback<ListRenderItem<SpotMarket>>(
    ({ item }) => (
      <SpotRow
        market={item}
        isFavorite={favorites.has(item.symbol)}
        onToggleFavorite={toggleFavorite}
        onOpen={onOpenMarket}
      />
    ),
    [favorites, toggleFavorite, onOpenMarket],
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
    clear: clearRecents,
  } = useRecentSearches();
  const setActiveCoin = useSetActiveCoin();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabValue>("All");
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const interactingRef = useRef(false);

  /** Stored pair symbols, shown as slash-form cards in Search History. */
  const recentItems = useMemo<RecentCoin[]>(
    () => recents.map((symbol) => ({ symbol, label: formatPairSymbol(symbol) })),
    [recents],
  );

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
    // Search should span every pair, not only the quote/tab that happened to be selected.
    setTab("All");
  }, []);

  const handleSearchBlur = useCallback(() => {
    if (interactingRef.current) return;
    setIsSearchFocused(false);
  }, []);

  /** Marks a tap inside the panel so the blur that follows cannot close it. */
  const handleSuggestInteract = useCallback(() => {
    interactingRef.current = true;
  }, []);

  const closeSearch = useCallback(() => {
    setSearch("");
    setIsSearchFocused(false);
    interactingRef.current = false;
    Keyboard.dismiss();
  }, []);

  /** Filters the list; it deliberately does not touch history — only opening a pair records it. */
  const commitSearch = useCallback(
    (query: string) => {
      setSearch(query);
      setIsSearchFocused(false);
      interactingRef.current = false;
      Keyboard.dismiss();
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    commitSearch(search);
  }, [commitSearch, search]);

  /** Opening a pair from the results list is what the history records, not the typed query. */
  const handleOpenMarket = useCallback(
    (symbol: string) => {
      addRecent(symbol);
      closeSearch();
    },
    [addRecent, closeSearch],
  );

  const openPair = useCallback(
    (symbol: string) => {
      const market = findMarketBySymbol(markets, symbol);
      setActiveCoin(
        market
          ? { symbol: market.symbol, name: market.baseName, decimals: market.priceDecimals }
          : { symbol, name: symbol.split("-")[0] ?? symbol, decimals: 8 },
      );
      router.navigate("/(tabs)/trade");
    },
    [markets, setActiveCoin],
  );

  const handleRecentSelect = useCallback(
    (item: RecentCoin) => {
      addRecent(item.symbol);
      closeSearch();
      openPair(item.symbol);
    },
    [addRecent, closeSearch, openPair],
  );

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

      {/*
        Both panels stay mounted and only their visibility flips. Mounting/unmounting the market
        list on every focus would tear down and rebuild ~20 rows (each with SVGs) behind the
        keyboard, which is the slow part of tapping the search bar.
      */}
      <View style={styles.body}>
        <View
          style={!showSuggestions ? styles.hidden : undefined}
          pointerEvents={showSuggestions ? "auto" : "none"}
          accessibilityElementsHidden={!showSuggestions}
          importantForAccessibility={showSuggestions ? "auto" : "no-hide-descendants"}
        >
          <RecentSearches
            items={recentItems}
            onSelect={handleRecentSelect}
            onClear={clearRecents}
            onInteract={handleSuggestInteract}
          />
          <PopularSearches symbols={popularSymbols} onSelect={commitSearch} />
        </View>

        <View
          style={[styles.listLayer, showSuggestions && styles.hidden]}
          pointerEvents={showSuggestions ? "none" : "auto"}
          accessibilityElementsHidden={showSuggestions}
          importantForAccessibility={showSuggestions ? "no-hide-descendants" : "auto"}
        >
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
            onOpenMarket={handleOpenMarket}
          />
        </View>
      </View>
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
  body: {
    flex: 1,
  },
  /** The list fills the space; the suggestion panel above it keeps its natural height. */
  listLayer: {
    flex: 1,
  },
  /** Hidden but mounted, so switching panels never rebuilds the list. */
  hidden: {
    display: "none",
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
