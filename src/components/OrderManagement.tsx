import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AssetsPanel } from "@/components/AssetsPanel";
import { OrderHistoryPanel } from "@/components/OrderHistoryPanel";
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

const TABS = ["Open Orders", "Order History", "Assets"] as const;

/** Floor for a tab's width, so all of them stay legible and the bar scrolls instead of squeezing. */
const TAB_MIN_WIDTH = 96;

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

  // Only a genuinely empty list is a loading state. A refresh runs in the background after every
  // cancel, and replacing live rows with a spinner then would throw away what the user just did.
  const showLoading = isLoading && orders.length === 0;
  const showEmpty = !showLoading && visibleOrders.length === 0;

  let content: ReactNode;
  if (activeTab === 1) {
    content = <OrderHistoryPanel symbol={symbol} />;
  } else if (activeTab === 2) {
    content = <AssetsPanel symbol={symbol} />;
  } else {
    content = (
      <>
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
      </>
    );
  }

  return (
    <View style={styles.container}>
      <TabBar tabs={TABS} activeIndex={activeTab} onPress={setActiveTab} />
      {content}
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
  // Horizontally scrollable so adding tabs cannot squeeze the labels on a narrow phone: each tab
  // keeps a minimum width and expands to fill the bar when there is room, scrolling only when
  // there is not.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabBar}
      contentContainerStyle={styles.tabBarContent}
    >
      {tabs.map((tab, i) => {
        const active = i === activeIndex;
        return (
          <Pressable
            key={tab}
            onPress={() => onPress(i)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <View style={styles.tabLabel}>
              {/* A shrink-wrapped column so the underline is only as wide as the label's text,
                  which is what "aligned to the tab's text area" means here. */}
              <View style={styles.tabUnderlineWrap}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab}
                </Text>
                <View
                  style={[
                    styles.tabIndicator,
                    active && styles.tabIndicatorActive,
                  ]}
                />
              </View>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    // Separates this section from the order form above it, which otherwise sits right on the
    // divider once the book and the form finish at the same line.
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  tabBar: {
    // The bar needs a fill of its own for the drop shadow to render on Android; it is the screen
    // colour, so the only things that show are the hairline and the soft shadow beneath it.
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
    marginBottom: spacing.sm,
    // A row, not a block: without this the ScrollView would try to claim the section's height.
    flexGrow: 0,
  },
  tabBarContent: {
    // Grows to the bar's width when the tabs fit, so they spread evenly; when they do not, each
    // tab holds its minimum width and the content overflows into a scroll.
    flexGrow: 1,
    alignItems: "stretch",
    gap: spacing.lg,
  },
  tab: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: TAB_MIN_WIDTH,
    height: 40,
  },
  tabLabel: {
    // Fills the tab so the label and its underline centre as one group.
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabUnderlineWrap: {
    alignItems: "center",
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    // Android reserves ascent/descent padding around glyphs, which pushes the label low even when
    // its box is centred. Dropping it plus a tight lineHeight lets the text sit optically centred.
    includeFontPadding: false,
    lineHeight: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  tabIndicator: {
    // Always rendered, transparent when inactive, so switching tabs cannot shift the layout. It
    // stretches to the wrap around the text, so the underline is exactly as wide as the label.
    marginTop: 3,
    alignSelf: "stretch",
    height: 2,
    backgroundColor: "transparent",
  },
  tabIndicatorActive: {
    backgroundColor: "#FFFFFF",
  },
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
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
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
    minHeight: 30,
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  symbol: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  type: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  price: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  filled: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: {
    height: 2,
    borderRadius: 1,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  status: {
    fontSize: 10,
    fontWeight: "600",
  },
  cancelBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: "rgba(246,70,93,0.12)",
    borderRadius: radius.sm,
    minWidth: 56,
    alignItems: "center",
  },
  cancelBtnDisabled: {
    opacity: 0.5,
  },
  cancelBtnText: {
    color: colors.down,
    fontSize: 10,
    fontWeight: "700",
  },
  cancelBtnTextLoading: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "600",
  },
});
