import { memo, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { View } from "@/components/AppLayout";
import { Text } from "@/components/AppText";

import { fetchTodayPnl, seedPriceIndex, type PnlToday } from "@/lib/kucoin/pnl";
import type { Ticker } from "@/lib/kucoin/types";
import { useBalanceVisibility } from "@/state/balanceVisibility";
import { spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";
import { formatPrice } from "@/utils/format";

const MASK = "••••••";

type Props = {
  /** Tickers the account fetch already produced — seeds the fee-conversion price index. */
  tickers: Ticker[];
};

/**
 * One quiet line under the balance total: today's realized spot PnL, built from KuCoin's own
 * fill records (avg-cost sells, fees in), not from anything the app accumulates.
 */
function TodayPnlComponent({ tickers }: Props) {
  const { colors } = useTheme();
  const { balancesVisible } = useBalanceVisibility();
  const styles = useStyles();
  const [reading, setReading] = useState<PnlToday | null>(null);

  useEffect(() => {
    seedPriceIndex(tickers);
  }, [tickers]);

  useEffect(() => {
    let cancelled = false;
    void fetchTodayPnl()
      .then((next) => {
        if (!cancelled) setReading(next);
      })
      .catch(() => {
        // A failure leaves the line in its loading state; the poll refreshes it later.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = reading?.change ?? null;
  const label = "Today's PnL";
  const color = !balancesVisible
    ? colors.textMuted
    : change === null
      ? colors.textMuted
      : change >= 0
        ? colors.upText
        : colors.downText;
  const text = !balancesVisible
    ? MASK
    : change === null
      ? "…"
      : `${change >= 0 ? "+" : "−"}$${formatPrice(Math.abs(change), 2)}`;

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color }]}>{text}</Text>
    </View>
  );
}

export const TodayPnl = memo(TodayPnlComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.xs,
      gap: spacing.sm,
    },
    label: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: "600",
    },
    value: {
      fontSize: 12,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
  }),
);
