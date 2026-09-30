import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { OrderBook } from "@/components/OrderBook";
import { TradePanel, type ExternalPriceSelection } from "@/components/TradePanel";
import { useLevel2Book } from "@/hooks/useLevel2Book";
import { useSymbolRules } from "@/hooks/useSymbolRules";
import { colors, spacing } from "@/theme";

type Props = {
  symbol: string;
  /** Latest trade price — prefills the panel and labels the middle of the book. */
  lastPrice?: number | null;
  /** Direction of the last move, for the middle price colour. */
  isUp?: boolean;
};

/**
 * The two columns of the trade view. It owns the pair's Level 2 feed and the one piece of shared
 * state between the children — the price the user tapped in the book. Both children are
 * memoized, so a depth tick re-renders only the book and a fill only the panel.
 *
 * Both columns size to their own content and are then stretched to the same height by the row's
 * `alignItems: 'stretch'`, so neither ends and the other starts at a different height. Neither
 * column scrolls: the screen owns the single scroll view, so a scrollable child here would be a
 * list nested inside a list, competing for the same gesture.
 */
export function TradeScreen({ symbol, lastPrice, isUp }: Props) {
  const { snapshot } = useLevel2Book(symbol);
  const { rules } = useSymbolRules(symbol);
  const [selection, setSelection] = useState<ExternalPriceSelection | null>(null);

  const handlePriceSelect = useCallback((value: string) => {
    // A fresh id each tap, so tapping the same row twice still refills the field.
    setSelection((previous) => ({ id: (previous?.id ?? 0) + 1, value }));
  }, []);

  const [baseCurrency = "", quoteCurrency = ""] = symbol.split("-");
  const tickSize = rules?.priceIncrement ?? "0.000001";
  const baseIncrement = rules?.baseIncrement ?? "0.000001";

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.book}>
          <OrderBook
            key={symbol}
            snapshot={snapshot}
            tickSize={tickSize}
            baseIncrement={baseIncrement}
            baseCurrency={baseCurrency}
            quoteCurrency={quoteCurrency}
            lastPrice={lastPrice}
            isUp={isUp}
            onPriceSelect={handlePriceSelect}
          />
        </View>
        <View style={styles.panel}>
          <TradePanel symbol={symbol} lastPrice={lastPrice} priceSelection={selection} />
        </View>
      </View>
    </View>
  );
}

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
    gap: spacing.sm,
  },
  book: {
    flex: 4,
  },
  panel: {
    flex: 6,
  },
});
