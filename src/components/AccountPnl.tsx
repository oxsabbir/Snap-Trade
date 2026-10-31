import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import { Pressable, View } from "@/components/AppLayout";
import { Text } from "@/components/AppText";

import {
  computePnlReading,
  createFlowCache,
  type PnlRange,
  type PnlReading,
} from "@/lib/kucoin/pnl";
import type { Ticker } from "@/lib/kucoin/types";
import { useBalanceVisibility } from "@/state/balanceVisibility";
import {
  ensurePortfolioHistoryLoaded,
  getPortfolioHistory,
  recordPortfolioSnapshot,
  subscribePortfolioHistory,
} from "@/state/portfolioHistory";
import { radius, spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";
import { formatPrice } from "@/utils/format";

const MASK = "••••••";

const RANGES: { key: PnlRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All" },
];

type Props = {
  /** The live portfolio total the windows are measured against. */
  total: number;
  /** Tickers the account fetch already produced, so PnL needs no extra public request. */
  tickers?: Ticker[];
};

/**
 * The PnL section inside the profile card: four range tabs and the corrected asset-value
 * change over the selected window.
 *
 * KuCoin has no account-level spot PnL endpoint, so the reading is the portfolio value's
 * move over the window minus the net deposits/withdrawals (fetched signed, one round-trip
 * per range, cached for the screen's lifetime). Snapshots land on every account refresh,
 * which means windows only become meaningful as the app accumulates history.
 */
function AccountPnlComponent({ total, tickers }: Props) {
  const { colors } = useTheme();
  const { balancesVisible } = useBalanceVisibility();
  const styles = useStyles();
  const history = useSyncExternalStore(
    subscribePortfolioHistory,
    getPortfolioHistory,
    getPortfolioHistory,
  );
  const flowCache = useMemo(() => createFlowCache(), []);
  const [range, setRange] = useState<PnlRange>("today");
  const [loaded, setLoaded] = useState<{
    range: PnlRange;
    reading: PnlReading;
  } | null>(null);
  // The tickers prop changes reference with every portfolio refresh; only its value matters.
  const tickersRef = useRef<Ticker[] | undefined>(tickers);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  useEffect(() => {
    ensurePortfolioHistoryLoaded();
  }, []);

  // Writes happen here as well, not only in useAccount: the store coalesces writes within
  // its gap, so whichever screen loads first seeds the history every other screen reads.
  useEffect(() => {
    recordPortfolioSnapshot(total);
  }, [total]);

  useEffect(() => {
    let cancelled = false;
    void computePnlReading(range, total, history, tickersRef.current, flowCache)
      .then((next) => {
        if (!cancelled) setLoaded({ range, reading: next });
      })
      .catch(() => {
        // An intermittent ledger failure keeps the section quiet rather than blanking it.
        if (!cancelled) setLoaded({ range, reading: { change: null, percent: null, flow: 0, loading: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [range, total, history, flowCache]);

  // A range switch immediately re-enters loading; a fresh total only refreshes the number.
  const isLoading = loaded === null || loaded.range !== range;
  const reading = isLoading ? null : loaded.reading;

  const rangeLabel = RANGES.find((r) => r.key === range)!.label;
  const change = reading?.change ?? null;
  const hasReading = reading !== null && change !== null && Number.isFinite(change);
  const tone = change !== null && change >= 0 ? colors.upText : colors.downText;

  return (
    <View style={styles.section}>
      <View style={styles.tabs}>
        {RANGES.map((option) => {
          const active = option.key === range;
          return (
            <Pressable
              key={option.key}
              onPress={() => setRange(option.key)}
              hitSlop={6}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`PnL for ${option.label.toLowerCase()}`}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.readingRow}>
        <Text style={styles.readingLabel}>PnL ({rangeLabel})</Text>
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : hasReading && balancesVisible && change !== null ? (
          <View style={styles.readingValueRow}>
            <Text
              style={[styles.readingValue, { color: tone }]}
              accessibilityLabel={`PnL ${change >= 0 ? "positive" : "negative"}`}
            >
              {`${change >= 0 ? "+" : "−"}$${formatPrice(Math.abs(change), 2)}`}
            </Text>
            {reading.percent !== null ? (
              <Text style={[styles.readingPercent, { color: tone }]}>
                {`${reading.percent >= 0 ? "+" : "−"}${Math.abs(reading.percent).toFixed(2)}%`}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={[styles.readingValue, { color: colors.textMuted }]}>
            {balancesVisible ? "—" : MASK}
          </Text>
        )}
      </View>

      {!balancesVisible || isLoading || !hasReading ? (
        <Text style={styles.flowNote}>
          Collecting history — windows fill as the app takes balance snapshots.
        </Text>
      ) : reading.flow === 0 ? (
        <Text style={styles.flowNote}>
          Asset value change, deposits and withdrawals excluded.
        </Text>
      ) : (
        <Text style={styles.flowNote}>
          Excludes {reading.flow > 0 ? "deposits" : "withdrawals"} made in this{" "}
          {rangeLabel.toLowerCase()}.
        </Text>
      )}
    </View>
  );
}

export const AccountPnl = memo(AccountPnlComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    section: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopColor: colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    tabs: {
      flexDirection: "row",
      gap: spacing.xs,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: 2,
    },
    tab: {
      flex: 1,
      minHeight: 26,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
    },
    tabActive: {
      backgroundColor: colors.upFill,
    },
    tabText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
    },
    tabTextActive: {
      color: colors.upText,
    },
    readingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    readingLabel: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: "600",
      flexShrink: 1,
    },
    readingValueRow: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: spacing.xs,
    },
    readingValue: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    readingPercent: {
      fontSize: 11,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    flowNote: {
      color: colors.textFaint,
      fontSize: 10,
      marginTop: 3,
    },
  }),
);
