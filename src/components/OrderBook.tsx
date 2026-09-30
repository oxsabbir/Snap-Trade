import { memo, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import {
  CaretDownIcon,
  CaretUpIcon,
  LayersIcon,
  RowsIcon,
} from "@/components/Icons";
import { useOrderBook } from "@/hooks/useOrderBook";
import {
  aggregationOptions,
  type DepthRow,
  type Level2Snapshot,
} from "@/lib/kucoin/orderbook";
import { colors, radius, spacing } from "@/theme";
import { decimalsFromIncrement, formatPrice } from "@/utils/format";

export type OrderBookViewMode = "split" | "bids" | "asks";

type Props = {
  snapshot: Level2Snapshot | null;
  /** Price step for a pair — also the base aggregation and the price formatting precision. */
  tickSize: string;
  /** Base-currency step, i.e. the size formatting precision. */
  baseIncrement: string;
  baseCurrency: string;
  quoteCurrency: string;
  lastPrice?: number | null;
  isUp?: boolean;
  onPriceSelect: (price: string) => void;
};

const ROW_HEIGHT = 20;
/** Currencies worth one dollar, so the mid price can carry a fiat line without a rates source. */
const USD_STABLES = new Set([
  "USD",
  "USDT",
  "USDC",
  "DAI",
  "BUSD",
  "TUSD",
  "USDD",
]);

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

function OrderBookBase({
  snapshot,
  tickSize,
  baseIncrement,
  baseCurrency,
  quoteCurrency,
  lastPrice,
  isUp,
  onPriceSelect,
}: Props) {
  const [aggregation, setAggregation] = useState(tickSize);
  const [viewMode, setViewMode] = useState<OrderBookViewMode>("split");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Rules arrive asynchronously, so the first render may use the fallback tick. Resetting during
  // render re-bases the step on the pair's real tick rather than leaving it on the fallback.
  const [activeTick, setActiveTick] = useState(tickSize);
  if (tickSize !== activeTick) {
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

  const hasPrice =
    lastPrice !== null && lastPrice !== undefined && Number.isFinite(lastPrice);
  const midColor = !hasPrice
    ? colors.textMuted
    : isUp
      ? colors.up
      : colors.down;
  const fiat = hasPrice && USD_STABLES.has(quoteCurrency) ? lastPrice : null;

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
          {depth.asks.map((row) => (
            <DepthRowView
              key={row.price}
              row={row}
              side="ask"
              priceDecimals={priceDecimals}
              sizeDecimals={sizeDecimals}
              onPress={onPriceSelect}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.middle}>
        <Text style={[styles.midPrice, { color: midColor }]}>
          {hasPrice ? formatPrice(lastPrice, priceDecimals) : "—"}
        </Text>
        {fiat !== null ? (
          <Text style={styles.fiat}>≈${formatPrice(fiat, 2)}</Text>
        ) : null}
      </View>

      {viewMode !== "asks" ? (
        <View style={styles.bids}>
          {depth.bids.map((row) => (
            <DepthRowView
              key={row.price}
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
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  middle: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  midPrice: {
    fontSize: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  fiat: {
    color: colors.textFaint,
    fontSize: 9,
    marginTop: 1,
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
