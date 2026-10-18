import {
  memo } from "react";
import { Pressable,
  StyleSheet,
  View
} from "react-native";
import { Text } from '@/components/AppText';

import { ChevronRightIcon } from "@/components/Icons";
import type { OrderHistoryEntry } from "@/hooks/useOrderHistory";
import { radius, spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";
import { decimalsFromPrice, formatDateTime, formatPrice } from "@/utils/format";

type Props = {
  entry: OrderHistoryEntry;
  /** The pair the history is being viewed for; its increments apply to its own rows. */
  symbol: string;
  /**
   * Decimal places for the pair's price, from its `priceIncrement`. Left undefined, or for a row of
   * another pair (the classic book is account-wide), the row's own printed price decides, so no
   * decimal count is ever hardcoded.
   */
  priceDecimals?: number;
  /** Decimal places for the pair's base size, from its `baseIncrement`. Falls back the same way. */
  sizeDecimals?: number;
  /** Opens the order's detail screen. Only wired once that screen exists. */
  onPress?: (entry: OrderHistoryEntry) => void;
};

/**
 * The card is drawn at 85% of the reference sizes: at full size the rows read a touch heavy beside
 * the rest of the screen, so every dimension is scaled together to keep the proportions.
 */
const SCALE = 0.85;
const scaled = (value: number): number => Math.round(value * SCALE);

/** Grows the scaled chevron to the 44pt minimum touch target on each axis. */
const CHEVRON_ICON_SIZE = scaled(16);
const CHEVRON_HIT_SLOP = { top: 15, bottom: 15, left: 15, right: 15 } as const;

/** The base asset of a symbol, e.g. `IR` for `IR-USDT`. */
function baseAsset(symbol: string): string {
  const separator = symbol.indexOf("-");
  return separator === -1 ? symbol : symbol.slice(0, separator);
}

/** Filled size against order size as a percentage; `0` for a size we cannot divide by. */
function filledPercent(entry: OrderHistoryEntry): number {
  const size = Number(entry.size);
  const filled = Number(entry.filledSize);
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (!Number.isFinite(filled) || filled <= 0) return 0;
  return (filled / size) * 100;
}

/**
 * One finished order, laid out the way KuCoin's order history reads: the pair and its status on
 * top, the type/side tags and timestamp below, then the fill, average and limit numbers. Flat on
 * the screen — no card fill — with a hairline under each row.
 *
 * Memoized on the entry and its two precisions, so a page append or a refresh re-renders only the
 * rows that actually changed while the list scrolls.
 */
function OrderHistoryCardComponent({
  entry,
  symbol,
  priceDecimals,
  sizeDecimals,
  onPress,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isBuy = entry.side === "buy";
  const isFilled = entry.status === "filled";

  // The increments belong to the pair on screen; a row for a different pair (the classic book spans
  // the account) keeps its own printed precision instead of borrowing the wrong pair's.
  const samePair = entry.symbol === symbol;
  const priceScale =
    samePair && priceDecimals !== undefined ? priceDecimals : decimalsFromPrice(entry.price);
  const sizeScale =
    samePair && sizeDecimals !== undefined ? sizeDecimals : decimalsFromPrice(entry.size);

  const percent = filledPercent(entry);
  const statusText = isFilled ? "Completed" : "Canceled";

  const pairText = entry.symbol.replace("-", "/");
  const typeText = entry.type === "limit" ? "Limit Price" : "Market Price";
  const sideText = isBuy ? "Buy" : "Sell";

  const filledText = formatPrice(Number(entry.filledSize) || 0, sizeScale);
  const sizeText = formatPrice(Number(entry.size) || 0, sizeScale);
  const avgText =
    entry.avgPrice === null ? "--" : formatPrice(Number(entry.avgPrice), priceScale);
  const orderPriceText =
    entry.type === "market" ? "Market" : formatPrice(Number(entry.price) || 0, priceScale);

  const handlePress = () => onPress?.(entry);

  const accessibilityLabel = `${pairText}, ${entry.side}, ${entry.type}, ${statusText.toLowerCase()} ${Math.round(percent)} percent, filled ${filledText} of ${sizeText}, average price ${avgText}`;

  const tagFill = isBuy ? styles.tagBuy : styles.tagSell;
  const tagTextColor = isBuy ? styles.tagTextBuy : styles.tagTextSell;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.card}
    >
      <View style={styles.headerRow}>
        <Text style={styles.pair} numberOfLines={1}>
          {pairText}
        </Text>
        <View style={styles.headerRight}>
          <Text style={styles.status} numberOfLines={1}>
            {statusText}({percent.toFixed(2)}%)
          </Text>
          <Pressable
            onPress={handlePress}
            hitSlop={CHEVRON_HIT_SLOP}
            accessible={false}
            importantForAccessibility="no"
          >
            <ChevronRightIcon size={CHEVRON_ICON_SIZE} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.tagRow}>
        <View style={[styles.tag, tagFill]}>
          <Text style={[styles.tagText, tagTextColor]}>{typeText}</Text>
        </View>
        <View style={[styles.tag, tagFill]}>
          <Text style={[styles.tagText, tagTextColor]}>{sideText}</Text>
        </View>
        <Text style={styles.time} numberOfLines={1}>
          {formatDateTime(entry.createdAt)}
        </Text>
      </View>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Filled/Amount ({baseAsset(entry.symbol)})</Text>
          <Text style={styles.detailValue}>
            {filledText}
            <Text style={styles.detailValueMuted}> / {sizeText}</Text>
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Avg. Price</Text>
          <Text style={styles.detailValue}>{avgText}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Order Price</Text>
          <Text style={styles.detailValue}>{orderPriceText}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export const OrderHistoryCard = memo(OrderHistoryCardComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
  card: {
    paddingVertical: scaled(spacing.lg),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: scaled(spacing.sm),
  },
  pair: {
    flexShrink: 1,
    color: colors.text,
    fontSize: scaled(16),
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: scaled(spacing.xs),
  },
  status: {
    color: colors.text,
    fontSize: scaled(13),
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: scaled(6),
    marginTop: scaled(spacing.xs),
  },
  tag: {
    borderRadius: scaled(radius.sm),
    paddingHorizontal: scaled(7),
    paddingVertical: scaled(2),
  },
  tagBuy: {
    backgroundColor: colors.upFill,
  },
  tagSell: {
    backgroundColor: colors.downFill,
  },
  tagText: {
    fontSize: scaled(12),
    fontWeight: "600",
  },
  tagTextBuy: {
    color: colors.upText,
  },
  tagTextSell: {
    color: colors.downText,
  },
  time: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: scaled(13),
    fontVariant: ["tabular-nums"],
  },
  details: {
    marginTop: scaled(spacing.md),
    gap: scaled(10),
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: scaled(spacing.sm),
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: scaled(13),
  },
  detailValue: {
    color: colors.text,
    fontSize: scaled(14),
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  detailValueMuted: {
    color: colors.textMuted,
    fontWeight: "400",
  },
  }),
);
