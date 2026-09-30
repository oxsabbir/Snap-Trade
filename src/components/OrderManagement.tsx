import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TrayIcon } from '@/components/Icons';
import { useOpenOrders, type OpenOrder } from '@/hooks/useOpenOrders';
import { formatAmount } from '@/utils/format';
import { colors, radius, spacing } from '@/theme';

type Props = {
  symbol: string;
  onDeposit?: () => void;
  onTutorial?: () => void;
  /** Trade-wallet available balances, passed from parent to avoid duplicate fetches. */
  available?: Record<string, string>;
};

const TABS = ['Open Orders', 'Assets'] as const;
const SUB_TABS = ['Open Orders', 'Advanced Orders'] as const;

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
  const isBuy = order.side === 'buy';
  const sideColor = isBuy ? colors.up : colors.down;
  const statusColor =
    order.status === 'filled'
      ? colors.up
      : order.status === 'cancelled'
      ? colors.down
      : order.status === 'partially_filled'
      ? colors.warning
      : colors.textMuted;

  const progress = filledFraction(order);
  const hasProgress = progress > 0;
  const isDone = order.status === 'filled' || order.status === 'cancelled';

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
            {order.symbol.replace('-', '/')}
          </Text>
          <Text style={styles.type}>{order.type === 'limit' ? 'Limit' : 'Market'}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.price}>Price: {formatAmount(Number(order.price))}</Text>
          <Text style={styles.filled}>{formatFilledDisplay(order)}</Text>
        </View>
        {hasProgress ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(progress * 100)}%`, backgroundColor: sideColor },
              ]}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.status, { color: statusColor }]}>
          {order.status.replace('_', ' ')}
        </Text>
        <Pressable
          onPress={onCancel}
          disabled={isCancelling || isDone}
          style={[styles.cancelBtn, (isCancelling || isDone) && styles.cancelBtnDisabled]}
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
  const [activeSubTab, setActiveSubTab] = useState(0);
  const [hideOtherPairs, setHideOtherPairs] = useState(false);

  const { orders, openCount, isLoading, error, cancelling, cancelOrder } = useOpenOrders();

  const usdtBalance = available['USDT'] ?? '0';

  // Filtering is presentational only, so toggling it never re-requests the list.
  const visibleOrders = useMemo(
    () => (hideOtherPairs ? orders.filter((order) => order.symbol === symbol) : orders),
    [orders, hideOtherPairs, symbol]
  );

  const handleCancel = useCallback(
    (orderId: string) => {
      void cancelOrder(orderId);
    },
    [cancelOrder]
  );

  if (activeTab !== 0) {
    return (
      <View style={styles.container}>
        <TabBar
          tabs={TABS}
          activeIndex={activeTab}
          onPress={setActiveTab}
        />
        <View style={styles.inactiveContent}>
          <Text style={styles.inactiveText}>
            {TABS[activeTab]} — coming soon
          </Text>
        </View>
      </View>
    );
  }

  // Only a genuinely empty list is a loading state. A refresh runs in the background after every
  // cancel, and replacing live rows with a spinner then would throw away what the user just did.
  const showLoading = isLoading && orders.length === 0;
  const showEmpty = !showLoading && visibleOrders.length === 0;

  return (
    <View style={styles.container}>
      <TabBar
        tabs={TABS}
        activeIndex={activeTab}
        onPress={setActiveTab}
      />

      <SubTabBar
        tabs={SUB_TABS}
        activeIndex={activeSubTab}
        counts={[openCount, 0]}
        onPress={setActiveSubTab}
        // Stop-loss and OCO are not implemented, so the tab stays visible for layout but refuses to
        // be opened rather than presenting a placeholder as if it were a working screen.
        disabledFrom={1}
      />

      <FilterRow
        hideOtherPairs={hideOtherPairs}
        onToggle={setHideOtherPairs}
      />

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
          style={[
            styles.tab,
            i === activeIndex && styles.tabActive,
          ]}
          accessibilityRole="tab"
          accessibilityState={{ selected: i === activeIndex }}
        >
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
        </Pressable>
      ))}
    </View>
  );
}

function SubTabBar({
  tabs,
  activeIndex,
  counts,
  onPress,
  disabledFrom = tabs.length,
}: {
  tabs: readonly string[];
  activeIndex: number;
  counts: readonly number[];
  onPress: (index: number) => void;
  /** Tabs at or past this index are not built yet and must not be selectable. */
  disabledFrom?: number;
}) {
  return (
    <View style={styles.subTabBar}>
      {tabs.map((tab, i) => {
        const disabled = i >= disabledFrom;
        return (
          <Pressable
            key={tab}
            onPress={() => {
              // Nothing to show, so the tap is refused rather than opening an empty screen that
              // looks like the app lost the orders.
              if (disabled) return;
              onPress(i);
            }}
            style={[styles.subTab, i === activeIndex && styles.subTabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === activeIndex, disabled }}
          >
            <Text
              style={[
                styles.subTabText,
                i === activeIndex && styles.subTabTextActive,
                disabled && styles.subTabTextDisabled,
              ]}
            >
              {tab} ({counts[i] ?? 0})
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterRow({
  hideOtherPairs,
  onToggle,
}: {
  hideOtherPairs: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <View style={styles.filterRow}>
      <Pressable
        onPress={() => onToggle(!hideOtherPairs)}
        style={styles.filterBtn}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: hideOtherPairs }}
        hitSlop={8}
      >
        <View
          style={[
            styles.checkbox,
            hideOtherPairs && styles.checkboxChecked,
          ]}
        >
          {hideOtherPairs && <View style={styles.checkboxInner} />}
        </View>
        <Text style={styles.filterLabel}>Hide other pairs</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  tabBar: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    minHeight: 40,
  },
  tabActive: {},
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text,
  },
  tabIndicator: {
    height: 2,
    borderRadius: 1,
    marginTop: 2,
    backgroundColor: 'transparent',
  },
  tabIndicatorActive: {
    backgroundColor: colors.accent,
  },
  subTabBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
  },
  subTabActive: {
    backgroundColor: colors.accent,
  },
  subTabText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  subTabTextActive: {
    color: '#06231C',
  },
  subTabTextDisabled: {
    color: colors.textFaint,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  checkboxInner: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#06231C',
  },
  filterLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  errorBanner: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: 'rgba(246,70,93,0.16)',
    borderRadius: radius.sm,
  },
  errorText: {
    color: colors.down,
    fontSize: 12,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  emptyBalance: {
    color: colors.textMuted,
    fontSize: 13,
  },
  emptyButtons: {
    flexDirection: 'row',
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
    fontWeight: '600',
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
    alignSelf: 'stretch',
    borderRadius: 1.5,
    minHeight: 44,
  },
  rowLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  symbol: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  type: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  price: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  filled: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 1.5,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  status: {
    fontSize: 11,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'rgba(246,70,93,0.12)',
    borderRadius: radius.sm,
    minWidth: 64,
    alignItems: 'center',
  },
  cancelBtnDisabled: {
    opacity: 0.5,
  },
  cancelBtnText: {
    color: colors.down,
    fontSize: 11,
    fontWeight: '700',
  },
  cancelBtnTextLoading: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
  },
  inactiveContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  inactiveText: {
    color: colors.textFaint,
    fontSize: 13,
  },
});
