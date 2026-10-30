import {
  memo,
  useCallback,
  useMemo,
  useState } from "react";
import { View } from '@/components/AppLayout';
import { ActivityIndicator, FlatList, Keyboard, RefreshControl, type ListRenderItem, StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';
import { useIsFocused } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  FAVORITES_TAB,
  QuoteTabs,
  type TabValue,
} from "@/components/QuoteTabs";
import { PopularSearches } from "@/components/PopularSearches";
import { SearchBar } from "@/components/SearchBar";
import { SpotRow } from "@/components/SpotRow";
import { useSpotMarkets } from "@/hooks/useSpotMarkets";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchMarkets, type QuoteFilter } from "@/lib/kucoin/market";
import type { SpotMarket } from "@/lib/kucoin/types";
import { useFavorites } from "@/state/favorites";
import { spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";
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
  const { colors } = useTheme();
  const styles = useStyles();
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
  const styles = useStyles();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabValue>("All");
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Favorites outlive this screen — the store persists them to AsyncStorage, so a star sticks
  // across restarts and appears identically on the next cold start.
  const { favorites, toggleFavorite } = useFavorites();

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
    setIsSearchFocused(true);
    // Search should span every pair, not only the quote/tab that happened to be selected.
    setTab("All");
  }, []);

  const handleSearchBlur = useCallback(() => {
    setIsSearchFocused(false);
  }, []);

  /** Filters the list; it never records the query, only running a search does. */
  const commitSearch = useCallback((query: string) => {
    setSearch(query);
    setIsSearchFocused(false);
    Keyboard.dismiss();
  }, []);

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
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Separator() {
  const styles = useStyles();
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
  const styles = useStyles();
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

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
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
  }),
);