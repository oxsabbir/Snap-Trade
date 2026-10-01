import { memo, useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { OrderBook } from "@/components/OrderBook";
import {
  TradePanel,
  type ExternalPriceSelection,
} from "@/components/TradePanel";
import { colors, spacing } from "@/theme";

type Props = {
  symbol: string;
};

/**
 * The two columns of the trade view. It owns one piece of shared state between them — the
 * price the user tapped in the book — and nothing else.
 *
 * It deliberately holds no data subscriptions. It used to own the Level 2 feed and the pair's
 * rules, and pass a live price down to both children, which meant every depth snapshot and every
 * price tick re-rendered this component and handed both children a new prop. Each child now
 * owns what it displays: the book its own depth and mid price, the form its own seed price.
 * What is left here changes only when the user taps a row.
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
export const TradeScreen = memo(function TradeScreen({ symbol }: Props) {
  const [selection, setSelection] = useState<ExternalPriceSelection | null>(
    null,
  );

  const handlePriceSelect = useCallback((value: string) => {
    // A fresh id each tap, so tapping the same row twice still refills the field.
    setSelection((previous) => ({ id: (previous?.id ?? 0) + 1, value }));
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.book}>
          <OrderBook
            key={symbol}
            symbol={symbol}
            onPriceSelect={handlePriceSelect}
          />
        </View>
        <View style={styles.panel}>
          <TradePanel symbol={symbol} priceSelection={selection} />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
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
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.lg,
  },
  book: {
    flex: 4,
  },
  panel: {
    flex: 5,
  },
});
