import { memo, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  CaretDownIcon,
  CaretUpIcon,
  LayersIcon,
  RowsIcon,
} from "@/components/Icons";
import { MidPrice } from "@/components/MidPrice";
import { useLevel2Book } from "@/hooks/useLevel2Book";
import { useOrderBook } from "@/hooks/useOrderBook";
import { useSymbolRules } from "@/hooks/useSymbolRules";
import { aggregationOptions, type DepthRow } from "@/lib/kucoin/orderbook";
import { colors, radius, spacing } from "@/theme";
import { decimalsFromIncrement, formatPrice } from "@/utils/format";

export type OrderBookViewMode = "split" | "bids" | "asks";

type Props = {
  symbol: string;
  onPriceSelect: (price: string) => void;
};

const ROW_HEIGHT = 26;

const VIEW_MODES: OrderBookViewMode[] = ["split", "bids", "asks"];

type RowProps = {
  row: DepthRow;
  side: "ask" | "bid";
  priceDecimals: number;
  sizeDecimals: number;
  onPress: (price: string) => void;
};

const DepthRowView = memo(function DepthRowView({
  row,
  side,
  priceDecimals,
  sizeDecimals,
  onPress,
}: RowProps) {
  const priceColor = side === "ask" ? colors.down : colors.up;
  const fill =
    side === "ask" ? "rgba(246,70,93,0.16)" : "rgba(35,175,137,0.16)";
  return (
    // `onPress` fires on release, not on touch-down, and that is deliberate. The rows sit
    // inside the screen's scroll view, so firing on press-in would fill the form every time
    // someone scrolled the page with a finger starting on the book.
    //
    // The rows are keyed by position (see the maps below), which keeps this same Pressable
    // mounted across snapshots. Keying them by price, as this did before, remounted all ten
    // rows on every depth snapshot — about seven times a second — so a press that was in
    // progress when one landed was cancelled by the row being torn out from under the finger.
    <Pressable
      onPress={() => onPress(row.price)}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`Price ${row.price}, total ${row.total}`}
    >
      <View
        style={[
          styles.fill,
          { width: `${row.percent}%`, backgroundColor: fill },
        ]}
      />
      <Text style={[styles.priceText, { color: priceColor }]} numberOfLines={1}>
        {formatPrice(Number(row.price), priceDecimals)}
      </Text>
      <Text style={styles.totalText} numberOfLines={1}>
        {formatPrice(Number(row.total), sizeDecimals)}
      </Text>
    </Pressable>
  );
});

/**
 * One pair's depth.
 *
 * Owns both of the things it displays rather than taking them as props. The Level 2 feed used
 * to be subscribed one level up, in the component that also renders the order form, so every
 * snapshot — six or seven a second — re-rendered that shared parent and the form's wrapper with
 * it. The feed belongs to the book, so it is subscribed here and the parent is left with nothing
 * to re-render on.
 *
 * The mid price went the other way: it used to arrive as a `lastPrice` prop, which changed on
 * every price tick and re-rendered the whole column to change two text nodes. It is now a leaf
 * that subscribes to the price itself.
 */
function OrderBookBase({ symbol, onPriceSelect }: Props) {
  const { snapshot } = useLevel2Book(symbol);
  const { rules } = useSymbolRules(symbol);
  const [baseCurrency = "", quoteCurrency = ""] = symbol.split("-");

  const [aggregation, setAggregation] = useState("0.000001");
  const [viewMode, setViewMode] = useState<OrderBookViewMode>("split");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Price step for the pair — also the base aggregation and the price formatting precision.
  // Rules arrive asynchronously, so the first render has nothing real to go on. Re-basing
  // during render switches to the pair's actual tick once it lands, rather than leaving the
  // book aggregating at the fallback.
  const tickSize = rules?.priceIncrement ?? "0.000001";
  const baseIncrement = rules?.baseIncrement ?? "0.000001";

  const [activeTick, setActiveTick] = useState<string | null>(null);
  if (activeTick !== tickSize) {
    setActiveTick(tickSize);
    setAggregation(tickSize);
  }

  const depth = useOrderBook(snapshot, aggregation);
  const options = useMemo(() => aggregationOptions(tickSize), [tickSize]);
  const priceDecimals = decimalsFromIncrement(tickSize);
  const sizeDecimals = decimalsFromIncrement(baseIncrement);

  const cycleView = () => {
    setViewMode(
      (current) =>
        VIEW_MODES[(VIEW_MODES.indexOf(current) + 1) % VIEW_MODES.length]!,
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Price ({quoteCurrency})</Text>
        <Text style={[styles.headerText, styles.headerRight]}>
          Total ({baseCurrency})
        </Text>
      </View>

      {viewMode !== "bids" ? (
        <View style={styles.asks}>
          {[...depth.asks].reverse().map((row, index) => (
            <DepthRowView
              key={`ask:${depth.asks.length - 1 - index}`}
              row={row}
              side="ask"
              priceDecimals={priceDecimals}
              sizeDecimals={sizeDecimals}
              onPress={onPriceSelect}
            />
          ))}
        </View>
      ) : null}

      <MidPrice
        symbol={symbol}
        priceDecimals={priceDecimals}
        quoteCurrency={quoteCurrency}
      />

      {viewMode !== "asks" ? (
        <View style={styles.bids}>
          {depth.bids.map((row, index) => (
            <DepthRowView
              key={`bid:${index}`}
              row={row}
              side="bid"
              priceDecimals={priceDecimals}
              sizeDecimals={sizeDecimals}
              onPress={onPriceSelect}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.percentBar}>
        <View style={[styles.pctPill, styles.pctBid]}>
          <Text style={styles.pctText}>B {depth.bidPercent.toFixed(0)}%</Text>
        </View>
        <View style={styles.percentTrack}>
          <View
            style={[
              styles.percentFill,
              styles.percentBid,
              { flex: Math.max(depth.bidPercent, 0.5) },
            ]}
          />
          <View
            style={[
              styles.percentFill,
              styles.percentAsk,
              { flex: Math.max(depth.askPercent, 0.5) },
            ]}
          />
        </View>
        <View style={[styles.pctPill, styles.pctAsk]}>
          <Text style={styles.pctText}>{depth.askPercent.toFixed(0)}% S</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={styles.stepButton}
          accessibilityRole="button"
          accessibilityLabel={`Aggregation step ${aggregation}`}
        >
          <LayersIcon size={12} color={colors.textMuted} />
          <Text style={styles.stepText}>{aggregation}</Text>
          <CaretDownIcon size={10} color={colors.textFaint} />
        </Pressable>

        <Pressable
          onPress={cycleView}
          style={styles.viewButton}
          accessibilityRole="button"
          accessibilityLabel={`View mode ${viewMode}`}
        >
          {viewMode === "split" ? (
            <RowsIcon size={14} color={colors.textMuted} />
          ) : viewMode === "bids" ? (
            <CaretDownIcon size={14} color={colors.up} />
          ) : (
            <CaretUpIcon size={14} color={colors.down} />
          )}
        </Pressable>
      </View>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Price step</Text>
            {options.map((option) => {
              const active = option === aggregation;
              return (
                <Pressable
                  key={option}
                  onPress={() => {
                    setAggregation(option);
                    setPickerOpen(false);
                  }}
                  style={styles.option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[styles.optionText, active && styles.optionActive]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export const OrderBook = memo(OrderBookBase);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.xs,
  },
  headerText: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  headerRight: {
    textAlign: "right",
  },
  // Each side grows into whatever height the taller column leaves it, anchored against the middle
  // price band: asks sit on top of it and bids under it, so the extra space falls at the far
  // edges of the column instead of opening a gap in the middle of the book.
  asks: {
    flex: 1,
    justifyContent: "flex-end",
  },
  bids: {
    flex: 1,
    justifyContent: "flex-start",
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
  },
  priceText: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  totalText: {
    color: colors.textMuted,
    fontSize: 12,
    paddingRight: 2,
    fontVariant: ["tabular-nums"],
  },
  percentBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingTop: spacing.sm,
  },
  pctPill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.sm,
    minWidth: 44,
    alignItems: "center",
  },
  pctBid: {
    backgroundColor: "rgba(35,175,137,0.18)",
  },
  pctAsk: {
    backgroundColor: "rgba(246,70,93,0.18)",
  },
  pctText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  percentTrack: {
    flex: 1,
    flexDirection: "row",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  percentFill: {
    height: "100%",
  },
  percentBid: {
    backgroundColor: colors.up,
  },
  percentAsk: {
    backgroundColor: colors.down,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  stepButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 24,
  },
  stepText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  viewButton: {
    width: 28,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    minWidth: 180,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sheetTitle: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  option: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  optionText: {
    color: colors.text,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  optionActive: {
    color: colors.accent,
    fontWeight: "700",
  },
});
