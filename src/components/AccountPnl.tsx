import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { Pressable, View } from "@/components/AppLayout";
import { Text } from "@/components/AppText";

import {
  cachedPnlReading,
  pnlReading,
  seedPriceIndex,
  type PnlRange,
  type PnlReading,
} from "@/lib/kucoin/pnl";
import type { Ticker } from "@/lib/kucoin/types";
import { useBalanceVisibility } from "@/state/balanceVisibility";
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
  /** Tickers the account fetch already produced, so fee conversion needs no extra fetch. */
  tickers: Ticker[];
};

/**
 * The PnL section inside the profile card: four range tabs and realized spot trading PnL.
 *
 * The number is built from KuCoin's own trade records (`/fills`) — the same fills the KuCoin
 * apps' trade-history page shows — not from anything the app accumulates over time, so it is
 * correct from the first install. Realized PnL means closed round trips: sells released at
 * their average buy cost, fees included. Holdings' paper profit/loss lives in the portfolio
 * total above and is deliberately not double-counted here.
 */
function AccountPnlComponent({ tickers }: Props) {
  const { colors } = useTheme();
  const { balancesVisible } = useBalanceVisibility();
  const styles = useStyles();
  const [range, setRange] = useState<PnlRange>("today");
  const [loaded, setLoaded] = useState<{ range: PnlRange; reading: PnlReading } | null>(null);
  // The tickers prop changes reference with every portfolio refresh; only its value matters.
  const tickersRef = useRef(tickers);

  useEffect(() => {
    tickersRef.current = tickers;
    seedPriceIndex(tickers);
  }, [tickers]);

  useEffect(() => {
    let cancelled = false;
    // A settled cache from a previous visit paints immediately, then the fresh computation
    // reconciles beneath it.
    void (cachedPnlReading(range) ?? pnlReading(range))
      .then((reading) => {
        if (!cancelled) setLoaded({ range, reading });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ range, reading: { change: null, trades: 0, partial: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const isLoading = loaded === null || loaded.range !== range;
  const change = loaded?.reading.change ?? null;
  const hasReading = !isLoading && change !== null && Number.isFinite(change);
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
        <Text style={styles.readingLabel}>PnL ({RANGES.find((r) => r.key === range)!.label})</Text>
        {isLoading ? (
          <Text style={[styles.readingValue, { color: colors.textMuted }]}>…</Text>
        ) : hasReading && change !== null ? (
          <Text
            style={[styles.readingValue, { color: tone }]}
            accessibilityLabel={`PnL ${change >= 0 ? "positive" : "negative"}`}
          >
            {balancesVisible
              ? `${change >= 0 ? "+" : "−"}$${formatPrice(Math.abs(change), 2)}`
              : MASK}
          </Text>
        ) : (
          <Text style={[styles.readingValue, { color: colors.textMuted }]}>—</Text>
        )}
      </View>

      <Text style={styles.flowNote}>{noteFor(isLoading, hasReading, loaded?.reading)}</Text>
    </View>
  );
}

/**
 * One quiet line under the number: state it truthfully by default, and only mention the
 * history cap when the engine actually hit it (the number then leans conservative).
 */
function noteFor(
  isLoading: boolean,
  hasReading: boolean,
  reading: PnlReading | undefined,
): string {
  if (isLoading) return "Realized spot trading PnL, from your KuCoin trade history.";
  if (!hasReading || !reading) return "No trades in this period.";
  if (reading.partial) {
    return "Deep history beyond KuCoin's page limit is not counted — treat as a floor.";
  }
  return "Realized spot trading PnL, from your KuCoin trade history.";
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
    readingValue: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    flowNote: {
      color: colors.textFaint,
      fontSize: 10,
      marginTop: 3,
    },
  }),
);
