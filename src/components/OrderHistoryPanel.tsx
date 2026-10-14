import { memo, useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { OrderHistoryCard } from "@/components/OrderHistoryCard";
import { TrayIcon } from "@/components/Icons";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import { useSymbolRules } from "@/hooks/useSymbolRules";
import { colors, radius, spacing } from "@/theme";
import { decimalsFromIncrement } from "@/utils/format";

type Props = {
  /** The pair being traded; the HF leg of the history is scoped to it. */
  symbol: string;
};

const EMPTY_TRAY_SIZE = 48;

/**
 * The Order History tab. Finished orders only — filled or cancelled — which the exchange keeps for
 * a bounded window, unlike the live rows Open Orders shows. The data comes from the same signed
 * endpoints the rest of the screen uses; nothing here is mocked.
 */
function OrderHistoryPanelComponent({ symbol }: Props) {
  const { orders, isLoading, isLoadingMore, error, refresh } = useOrderHistory(symbol);
  // The card prints the numbers at the pair's own precision, using the same `/symbols` increments
  // the order book and trade panel already read, rather than a hardcoded decimal count.
  const { rules } = useSymbolRules(symbol);
  const priceDecimals = rules ? decimalsFromIncrement(rules.priceIncrement) : undefined;
  const sizeDecimals = rules ? decimalsFromIncrement(rules.baseIncrement) : undefined;

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
        <View>
          {orders.map((entry) => (
            <OrderHistoryCard
              key={entry.orderId}
              entry={entry}
              symbol={symbol}
              priceDecimals={priceDecimals}
              sizeDecimals={sizeDecimals}
            />
          ))}
          {/* Older pages are paged in as the screen nears its bottom; this is the only place the
              append is visible while it is in flight. */}
          {isLoadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          ) : null}
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
  footer: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
});
