import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ReactNode } from "react";
import { Pressable, ScrollView, View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { AssetsPanel } from "@/components/AssetsPanel";
import { OrderHistoryPanel } from "@/components/OrderHistoryPanel";
import { TrayIcon } from "@/components/Icons";
import { useOpenOrders, type OpenOrder } from "@/hooks/useOpenOrders";
import { formatAmount } from "@/utils/format";
import { radius, spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";

type Props = {
  symbol: string;
  onDeposit?: () => void;
  onTutorial?: () => void;
  /** Trade-wallet available balances, passed from parent to avoid duplicate fetches. */
  available?: Record<string, string>;
};

const TABS = ["Open Orders", "Assets", "Order History"] as const;

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
  return `${formatAmount(Number(order.filledSize) || 0)} / ${formatAmount(total)}`;
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
  const { colors } = useTheme();
  const styles = useStyles();
  const isBuy = order.side === "buy";
  const sideColor = isBuy ? colors.up : colors.down;
  const sideTextColor = isBuy ? colors.upText : colors.downText;
  const progress = filledFraction(order);
  const percent = Math.round(progress * 100);
  const isPartiallyFilled = progress > 0;
  const statusLabel = isPartiallyFilled ? "Partially filled" : "Open";
  const remaining = Math.max(0, Number(order.size) - Number(order.filledSize));

  return (
    <View style={[styles.row, isCancelling && styles.rowCancelling]}>
      <View style={styles.rowHeader}>
        <View style={styles.identity}>
          <View style={[styles.sideDot, { backgroundColor: sideColor }]} />
          <Text style={[styles.symbol, { color: colors.text }]} numberOfLines={1}>
            {order.symbol.replace("-", "/")}
          </Text>
          <View style={[styles.sideBadge, { backgroundColor: isBuy ? colors.upFill : colors.downFill }]}>
            <Text style={[styles.sideBadgeText, { color: sideTextColor }]}>
              {order.side.toUpperCase()}
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.statusBadge,
            isPartiallyFilled && { backgroundColor: isBuy ? colors.upFill : colors.downFill },
          ]}
        >
          <Text style={[styles.status, isPartiallyFilled && { color: sideTextColor }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <View style={styles.orderMeta}>
        <Text style={styles.type}>{order.type === "limit" ? "LIMIT" : "MARKET"}</Text>
        <Text style={styles.metaDivider}>·</Text>
        <Text style={styles.price} numberOfLines={1}>
          {order.type === "market" ? "Market price" : `${formatAmount(Number(order.price))} USDT`}
        </Text>
      </View>

      <View style={styles.progressHeader}>
        <Text style={styles.progressTitle}>Filled</Text>
        <Text style={[styles.progressPercent, { color: sideTextColor }]}>{percent}%</Text>
      </View>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: percent }}
      >
        <View
          style={[
            styles.progressFill,
            { width: `${percent}%`, backgroundColor: sideColor },
          ]}
        />
      </View>

      <View style={styles.rowFooter}>
        <View style={styles.fillDetails}>
          <Text style={styles.filled}>{formatFilledDisplay(order)} {order.symbol.split("-")[0]}</Text>
          <Text style={styles.remaining}>Remaining {formatAmount(remaining)}</Text>
        </View>
        <Pressable
          onPress={onCancel}
          disabled={isCancelling}
          style={[styles.cancelBtn, isCancelling && styles.cancelBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel={`Cancel order ${order.orderId.slice(0, 8)}`}
          hitSlop={8}
        >
          <Text style={styles.cancelBtnText}>{isCancelling ? "Cancelling…" : "Cancel order"}</Text>
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
  const { colors } = useTheme();
  const styles = useStyles();
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
  const styles = useStyles();
  const [activeTab, setActiveTab] = useState(0);

  const { orders, isLoading, error, cancelling, cancelOrder } = useOpenOrders();

  const usdtBalance = available["USDT"] ?? "0";

  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          (order.status === "open" || order.status === "partially_filled") &&
          filledFraction(order) < 1,
      ),
    [orders],
  );

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
    content = <AssetsPanel symbol={symbol} />;
  } else if (activeTab === 2) {
    content = <OrderHistoryPanel symbol={symbol} />;
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
  const styles = useStyles();
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
            <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
              {tab}
            </Text>
            {/* Pinned to the tab's bottom and stretched across it, so the active underline is the
                full width of the tab rather than only the label. */}
            <View
              style={[
                styles.tabIndicator,
                active && styles.tabIndicatorActive,
              ]}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = createThemedStyles((colors) => StyleSheet.create({
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
    // Full-bleed within the section, cancelling the container's horizontal padding so the tabs run
    // edge to edge instead of leaving a gutter on the left and right.
    marginHorizontal: -spacing.md,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
    // A row, not a block: without this the ScrollView would try to claim the section's height.
    flexGrow: 0,
  },
  tabBarContent: {
    // Grows to the bar's width when the tabs fit, so they spread evenly; when they do not, each
    // tab holds its minimum width and the content overflows into a scroll.
    flexGrow: 1,
    alignItems: "stretch",
  },
  tab: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: TAB_MIN_WIDTH,
    // Tall enough to give the label even space above and below, with the underline at the edge.
    height: 44,
    alignItems: "center",
    justifyContent: "center",
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
    color: colors.text,
  },
  tabIndicator: {
    // Always rendered, transparent when inactive, so switching tabs cannot shift the layout. Pinned
    // to the bottom and stretched across the tab, so the underline spans the tab's full width.
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: "transparent",
  },
  tabIndicatorActive: {
    backgroundColor: colors.text,
  },
  errorBanner: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.downFill,
    borderRadius: radius.sm,
  },
  errorText: {
    color: colors.downText,
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
    gap: spacing.sm,
  },
  row: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  rowCancelling: {
    borderColor: colors.warning,
    opacity: 0.75,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  symbol: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  sideDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  sideBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  sideBadgeText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  status: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  orderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  type: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
  },
  price: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  metaDivider: {
    color: colors.textFaint,
    fontSize: 12,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  progressTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: {
    height: 5,
    borderRadius: radius.pill,
  },
  rowFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  fillDetails: {
    flex: 1,
    gap: 2,
  },
  filled: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  remaining: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  cancelBtn: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.downFill,
    borderRadius: radius.md,
  },
  cancelBtnDisabled: {
    opacity: 0.5,
  },
  cancelBtnText: {
    color: colors.downText,
    fontSize: 11,
    fontWeight: "700",
  },
}));
