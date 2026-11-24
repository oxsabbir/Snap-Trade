import { memo, useCallback, useState } from "react";
import { View } from '@/components/AppLayout';
import { Text } from '@/components/AppText';
import { StyleSheet } from 'react-native';

import { OrderBook } from "@/components/OrderBook";
import {
  TradePanel,
  type ExternalPriceSelection,
} from "@/components/TradePanel";
import { radius, spacing } from "@/theme";
import { createThemedStyles } from "@/theme/themedStyles";
import { useSymbolRules } from "@/hooks/useSymbolRules";
import { useUserTradeFees } from "@/hooks/useUserTradeFees";
import type { OrderSide } from "@/lib/kucoin/types";

type Props = {
  symbol: string;
  onInitialBookSnapshot?: (symbol: string) => void;
  quickBuyByDefault?: boolean;
};

/**
 * The two columns of the trade view. It owns one piece of shared state between them — the
 * price the user tapped in the book — and nothing else.
 *
 * It shares one pair fee quote between the depth presets and the form. It used to own the Level 2
 * feed and the pair's rules, and pass a live price down to both children, which meant every depth
 * snapshot and every price tick re-rendered this component and handed both children a new prop.
 * Each child now owns what it displays: the book its own depth and mid price, the form its own seed
 * price. The fee quote only changes on pair load; the selected order changes only when the user
 * taps a row or preset.
 *
 * The balance is deliberately not a prop either. It was threaded through here once, which meant
 * every `/accounts` poll handed this `memo`'d component a fresh object and re-rendered the whole
 * order form to update one number. It now comes from the shared store in `state/balance`, so a
 * balance change updates the form directly and leaves this component alone.
 *
 * Both columns size to their own content and are then stretched to the same height by the row's
 * `alignItems: 'stretch'`, so neither ends and the other starts at a different height. Neither
 * column scrolls: the screen owns the single scroll view, so a scrollable child here would be a
 * list nested inside a list, competing for the same gesture.
 */
export const TradeScreen = memo(function TradeScreen({
  symbol,
  onInitialBookSnapshot,
  quickBuyByDefault,
}: Props) {
  const styles = useStyles();
  const { rules } = useSymbolRules(symbol);
  const { takerFeeRate } = useUserTradeFees(symbol);
  const [selection, setSelection] = useState<ExternalPriceSelection | null>(
    null,
  );

  const handlePriceSelect = useCallback((value: string, size?: string, side?: OrderSide) => {
    // A fresh id each tap, so tapping the same row twice still refills the field.
    setSelection((previous) => ({
      id: (previous?.id ?? 0) + 1,
      value,
      ...(size ? { size } : {}),
      ...(side ? { side } : {}),
    }));
  }, []);

  return (
    <View style={styles.container}>
      {rules?.st ? (
        <View style={styles.stBanner} accessibilityRole="text">
          <View style={styles.stBadge}>
            <Text style={styles.stBadgeText}>ST</Text>
          </View>
          <Text style={styles.stNotice} numberOfLines={1}>
            Special Treatment · KuCoin delisting watch
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.book}>
          <OrderBook
            symbol={symbol}
            takerFeeRate={takerFeeRate}
            onPriceSelect={handlePriceSelect}
            onInitialSnapshot={onInitialBookSnapshot}
            quickBuyByDefault={quickBuyByDefault}
          />
        </View>
        <View style={styles.panel}>
          <TradePanel
            symbol={symbol}
            takerFeeRate={takerFeeRate}
            priceSelection={selection}
          />
        </View>
      </View>
    </View>
  );
});

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    container: {
      // A hairline separates the ordering UI from the chart above it. It is drawn on this section
      // rather than on either column, so it spans the full width and reads as one boundary.
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.md,
    },
    stBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.sm,
      backgroundColor:
        colors.bg === "#121212"
          ? "rgba(240, 185, 11, 0.12)"
          : "rgba(180, 83, 9, 0.08)",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.warning,
    },
    stBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: colors.warning,
    },
    stBadgeText: {
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.4,
    },
    stNotice: {
      flex: 1,
      color: colors.warning,
      fontSize: 11,
      fontWeight: "600",
    },
    row: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: spacing.md,
    },
    book: {
      flex: 4,
    },
    panel: {
      flex: 6,
    },
  }),
);
