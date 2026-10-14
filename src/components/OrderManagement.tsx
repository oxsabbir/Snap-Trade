import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AssetsPanel } from "@/components/AssetsPanel";
import { TrayIcon } from "@/components/Icons";
import { useOpenOrders, type OpenOrder } from "@/hooks/useOpenOrders";
import { formatAmount } from "@/utils/format";
import { colors, radius, spacing } from "@/theme";

type Props = {
  symbol: string;
  onDeposit?: () => void;
  onTutorial?: () => void;
  /** Trade-wallet available balances, passed from parent to avoid duplicate fetches. */
  available?: Record<string, string>;
};

const TABS = ["Open Orders", "Assets"] as const;

const EMPTY_TRAY_SIZE = 64;

/** Filled size against the ordered size, as a 0..1 fraction for the row's progress bar. */
function filledFraction(order: OpenOrder): number {
  const total = Number(order.size);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const filled = Number(order.filledSize);
  if (!Number.isFinite(filled) || filled <= 0) return 0;
  return Math.min(1, filled / total);
}

function formatFilledDisplay(order: OpenOrder): string {
  const total = Number(order.size);
  if (!Number.isFinite(total) || total <= 0) {
    return `${formatAmount(Number(order.filledSize) || 0)} / —`;
  }
  const pct = Math.round(filledFraction(order) * 100);
  return `${formatAmount(Number(order.filledSize) || 0)} / ${formatAmount(total)} · ${pct}%`;
}

function OrderRow({
  order,
  onCancel,
  isCancelling,
}: {
  order: OpenOrder;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  const isBuy = order.side === "buy";
  const sideColor = isBuy ? colors.up : colors.down;
  const statusColor =
    order.status === "filled"
      ? colors.up
      : order.status === "cancelled"
        ? colors.down
        : order.status === "partially_filled"
          ? colors.warning
          : colors.textMuted;

  const progress = filledFraction(order);
  const hasProgress = progress > 0;
  const isDone = order.status === "filled" || order.status === "cancelled";

  return (
    <View
      style={[
        styles.row,
        isDone && styles.rowDone,
        isCancelling && styles.rowCancelling,
      ]}
    >
      <View style={[styles.sideIndicator, { backgroundColor: sideColor }]} />
      <View style={styles.rowLeft}>
        <View style={styles.rowTop}>
          <Text style={[styles.symbol, { color: sideColor }]}>
            {order.symbol.replace("-", "/")}
          </Text>
          <Text style={styles.type}>
            {order.type === "limit" ? "Limit" : "Market"}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.price}>
            Price: {formatAmount(Number(order.price))}
          </Text>
          <Text style={styles.filled}>{formatFilledDisplay(order)}</Text>
        </View>
        {hasProgress ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.round(progress * 100)}%`,
                  backgroundColor: sideColor,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.status, { color: statusColor }]}>
          {order.status.replace("_", " ")}
        </Text>
        <Pressable
          onPress={onCancel}
          disabled={isCancelling || isDone}
          style={[
            styles.cancelBtn,
            (isCancelling || isDone) && styles.cancelBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Cancel order ${order.orderId.slice(0, 8)}`}
          hitSlop={8}
        >
          {isCancelling ? (
            <Text style={styles.cancelBtnTextLoading}>Cancelling…</Text>
          ) : (
            <Text style={styles.cancelBtnText}>Cancel</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function EmptyState({
  balance,
  onDeposit,
  onTutorial,
}: {
  balance: string;
  onDeposit?: () => void;
  onTutorial?: () => void;
}) {
  return (
    <View style={styles.emptyContainer}>
      <TrayIcon size={EMPTY_TRAY_SIZE} color={colors.textFaint} />
      <Text style={styles.emptyBalance}>Available: {balance} USDT</Text>
      <View style={styles.emptyButtons}>
        <Pressable
          onPress={onDeposit}
          style={styles.emptyBtn}
          accessibilityRole="button"
        >
          <Text style={styles.emptyBtnText}>Deposit/Transfer</Text>
        </Pressable>
        <Pressable
          onPress={onTutorial}
          style={styles.emptyBtn}
          accessibilityRole="button"
        >
          <Text style={styles.emptyBtnText}>Spot Trading Tutorial</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const OrderManagement = memo(function OrderManagement({
  symbol,
  onDeposit,
  onTutorial,
  available = {},
}: Props) {
  const [activeTab, setActiveTab] = useState(0);

  const { orders, isLoading, error, cancelling, cancelOrder } = useOpenOrders();

  const usdtBalance = available["USDT"] ?? "0";

  const visibleOrders = useMemo(() => orders, [orders]);

  const handleCancel = useCallback(
    (orderId: string) => {
      void cancelOrder(orderId);
    },
    [cancelOrder],
  );

  if (activeTab !== 0) {
    return (
      <View style={styles.container}>
        <TabBar tabs={TABS} activeIndex={activeTab} onPress={setActiveTab} />
        <AssetsPanel symbol={symbol} />
      </View>
    );
  }

  // Only a genuinely empty list is a loading state. A refresh runs in the background after every
  // cancel, and replacing live rows with a spinner then would throw away what the user just did.
  const showLoading = isLoading && orders.length === 0;
  const showEmpty = !showLoading && visibleOrders.length === 0;

  return (
    <View style={styles.container}>
      <TabBar tabs={TABS} activeIndex={activeTab} onPress={setActiveTab} />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {showLoading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading orders…</Text>
        </View>
      ) : showEmpty ? (
        <EmptyState
          balance={formatAmount(Number(usdtBalance))}
          onDeposit={onDeposit}
          onTutorial={onTutorial}
        />
      ) : (
        // A plain column, not a scroll view: the route already owns one for the whole screen
        // and a list nested inside it fights the user for the same gesture.
        <View style={styles.list}>
          {visibleOrders.map((order) => (
            <OrderRow
              key={order.orderId}
              order={order}
              onCancel={() => handleCancel(order.orderId)}
              isCancelling={cancelling.has(order.orderId)}
            />
          ))}
        </View>
      )}
    </View>
  );
});

function TabBar({
  tabs,
  activeIndex,
  onPress,
}: {
  tabs: readonly string[];
  activeIndex: number;
  onPress: (index: number) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab, i) => (
        <Pressable
          key={tab}
          onPress={() => onPress(i)}
          style={styles.tab}
          accessibilityRole="tab"
          accessibilityState={{ selected: i === activeIndex }}
        >
          <View style={styles.tabLabel}>
            <Text
              style={[
                styles.tabText,
                i === activeIndex && styles.tabTextActive,
              ]}
            >
              {tab}
            </Text>
            <View
              style={[
                styles.tabIndicator,
                i === activeIndex && styles.tabIndicatorActive,
              ]}
            />
          </View>
        </Pressable>
      ))}
    </View>
  );
}


  errorBanner: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: "rgba(246,70,93,0.16)",
    borderRadius: radius.sm,
  },
  errorText: {
    color: colors.down,
    fontSize: 12,
    fontWeight: "600",
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  emptyBalance: {
    color: colors.textMuted,
    fontSize: 13,
  },
  emptyButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  emptyBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
  },
  emptyBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  // A finished order stays on screen just long enough to read, so it is dimmed rather than
  // dropped while it lingers.
  rowDone: {
    opacity: 0.55,
  },
  // The row holds its place while the cancel is in flight so the spinner has something to show
  // on, and so a refused cancel leaves the order visible instead of silently swallowing it.
  rowCancelling: {
    opacity: 0.6,
  },
  sideIndicator: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 1.5,
    minHeight: 44,
  },
  rowLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  symbol: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  type: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  price: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  filled: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: {
    height: 3,
    borderRadius: 1.5,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  status: {
    fontSize: 11,
    fontWeight: "600",
  },
  cancelBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(246,70,93,0.12)",
    borderRadius: radius.sm,
    minWidth: 64,
    alignItems: "center",
  },
  cancelBtnDisabled: {
    opacity: 0.5,
  },
  cancelBtnText: {
    color: colors.down,
    fontSize: 11,
    fontWeight: "700",
  },
  cancelBtnTextLoading: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "600",
  },
});
