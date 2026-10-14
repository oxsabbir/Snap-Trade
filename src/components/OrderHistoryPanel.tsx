import { memo, useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { TrayIcon } from "@/components/Icons";
import { useOrderHistory, type OrderHistoryEntry } from "@/hooks/useOrderHistory";
import { colors, radius, spacing } from "@/theme";
import { formatAmount, formatDateTime, formatPrice } from "@/utils/format";

type Props = {
  /** The pair being traded; the HF leg of the history is scoped to it. */
  symbol: string;
};

const EMPTY_TRAY_SIZE = 48;

/** Average execution price, or a dash when the order never filled. */
function averageDisplay(entry: OrderHistoryEntry): string {
  if (entry.avgPrice === null) return "—";
  const value = Number(entry.avgPrice);
  return Number.isFinite(value) ? formatPrice(value) : "—";
}

function statusColor(status: OrderHistoryEntry["status"]): string {
  if (status === "filled") return colors.up;
  if (status === "cancelled") return colors.down;
  return colors.textMuted;
}

function statusLabel(status: OrderHistoryEntry["status"]): string {
  if (status === "filled") return "Filled";
  if (status === "cancelled") return "Cancelled";
  return "Open";
}

/**
 * One finished order. Same compact shape as the open-orders row — a side accent bar, the pair on
 * top with its side and type, and the numbers beneath — so the two tabs read as one list.
 */
function HistoryRow({ entry }: { entry: OrderHistoryEntry }) {
  const isBuy = entry.side === "buy";
  const sideColor = isBuy ? colors.up : colors.down;

  return (
    <View style={styles.row}>
      <View style={[styles.sideIndicator, { backgroundColor: sideColor }]} />
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[styles.symbol, { color: sideColor }]} numberOfLines={1}>
            {entry.symbol.replace("-", "/")}
          </Text>
          <Text style={styles.side}>{isBuy ? "Buy" : "Sell"}</Text>
          <Text style={styles.type}>
            {entry.type === "limit" ? "Limit" : "Market"}
          </Text>
          <View style={styles.spacer} />
          <Text style={[styles.status, { color: statusColor(entry.status) }]}>
            {statusLabel(entry.status)}
          </Text>
        </View>

        <View style={styles.rowBottom}>
          <View style={styles.stats}>
            <Text style={styles.detail} numberOfLines={1}>
              Avg {averageDisplay(entry)}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              Exec {formatAmount(Number(entry.filledSize) || 0)} /{" "}
              {formatAmount(Number(entry.size) || 0)}
            </Text>
          </View>
          <Text style={styles.time} numberOfLines={1}>
            {formatDateTime(entry.createdAt)}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The Order History tab. Finished orders only — filled or cancelled — which the exchange keeps for
 * a bounded window, unlike the live rows Open Orders shows. The data comes from the same signed
 * endpoints the rest of the screen uses; nothing here is mocked.
 */
function OrderHistoryPanelComponent({ symbol }: Props) {
  const { orders, isLoading, error, refresh } = useOrderHistory(symbol);

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  if (isLoading && orders.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View>
      {error ? (
        <View style={styles.errorRow}>
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
          <Pressable
            onPress={handleRetry}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading order history"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {orders.length === 0 ? (
        error ? null : (
          <View style={styles.emptyContainer}>
            <TrayIcon size={EMPTY_TRAY_SIZE} color={colors.textFaint} />
            <Text style={styles.emptyText}>No order history yet</Text>
          </View>
        )
      ) : (
        <View style={styles.list}>
          {orders.map((entry) => (
            <HistoryRow key={entry.orderId} entry={entry} />
          ))}
        </View>
      )}
    </View>
  );
}

export const OrderHistoryPanel = memo(OrderHistoryPanelComponent);

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: "rgba(246,70,93,0.16)",
    borderRadius: radius.sm,
  },
  errorText: {
    flex: 1,
    color: colors.down,
    fontSize: 12,
    fontWeight: "600",
  },
  retryText: {
    color: colors.down,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  sideIndicator: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 1.5,
    minHeight: 30,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  symbol: {
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  side: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.textMuted,
  },
  type: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  spacer: {
    flex: 1,
  },
  status: {
    fontSize: 10,
    fontWeight: "700",
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 1,
  },
  detail: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  time: {
    color: colors.textFaint,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
});
