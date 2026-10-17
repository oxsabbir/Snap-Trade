import { memo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CoinAvatar } from "@/components/CoinAvatar";
import { ChevronRightIcon } from "@/components/Icons";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { useTicker } from "@/state/ticker";
import { radius, spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";
import { formatAmount, formatPrice } from "@/utils/format";

type Props = {
  /** The pair being traded, e.g. `BTC-USDT`. Splits into the token and its quote on the dash. */
  symbol: string;
};

/** Quotes worth about a dollar, so a value in them can carry a `$` without a rates source. */
const USD_STABLES = new Set([
  "USD",
  "USDT",
  "USDC",
  "DAI",
  "BUSD",
  "TUSD",
  "USDD",
]);

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type SectionProps = {
  currency: string;
  total: number;
  available: number;
  locked: number;
  /** USD value of `total`, or `null` when the asset has no reliable dollar price. */
  usdValue: number | null;
};

/**
 * One asset, laid directly on the screen background rather than inside a floating card. The two
 * assets on this tab share this exact structure so only the symbol and the numbers change.
 */
function AssetSection({
  currency,
  total,
  available,
  locked,
  usdValue,
}: SectionProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <CoinAvatar symbol={currency} size={32} />
        <Text style={styles.symbol} numberOfLines={1}>
          {currency}
        </Text>
        <ChevronRightIcon size={16} color={colors.textFaint} />
      </View>

      <View style={styles.balance}>
        <View style={[styles.row, styles.rowTop]}>
          <Text style={styles.label}>Total Assets</Text>
          <View style={styles.valueCol}>
            <Text style={styles.value} numberOfLines={1}>
              {formatAmount(total)}
            </Text>
            {usdValue !== null ? (
              <Text style={styles.subValue} numberOfLines={1}>
                ${formatPrice(usdValue, 2)}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Available</Text>
          <Text style={styles.value} numberOfLines={1}>
            {formatAmount(available)}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Locked in Orders</Text>
          <Text style={styles.value} numberOfLines={1}>
            {formatAmount(locked)}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Avg. Cost Price</Text>
          {/* No cost basis is tracked, so this stays a dash rather than a fabricated figure. */}
          <Text
            style={[styles.value, styles.valueUnavailable]}
            numberOfLines={1}
          >
            —
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The Assets tab of the order view. The cash leg (USDT) and the position leg (the pair's base
 * token) each render the same section. Both read stores that already exist for the rest of the
 * screen, so opening this tab costs no request — the balance is loaded by the route and the price
 * is already streaming for the chart's mid-price label. The price is a leaf subscription, so a tick
 * repaints this panel and nothing above it.
 */
function AssetsPanelComponent({ symbol }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { available, holds, isLoading, error, refresh } = useAccountBalance();
  const { update } = useTicker(symbol);

  const [base, quote = ""] = symbol.split("-");
  const price = update && Number.isFinite(update.price) ? update.price : null;
  const quoteIsUsd = USD_STABLES.has(quote);

  const usdtAvailable = toNumber(available["USDT"]);
  const usdtLocked = toNumber(holds["USDT"]);
  const usdtTotal = usdtAvailable + usdtLocked;

  const baseAvailable = toNumber(available[base]);
  const baseLocked = toNumber(holds[base]);
  const baseTotal = baseAvailable + baseLocked;

  // A USDT pair values in dollars directly. Any other quote would need a rates source to be called
  // USD, so the valuation is simply left off rather than mislabelled.
  const baseUsd = price !== null && quoteIsUsd ? baseTotal * price : null;

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      {error ? (
        <View style={styles.errorRow}>
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
          <Pressable
            onPress={refresh}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Retry loading balances"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.divider} />
      <AssetSection
        currency={base}
        total={baseTotal}
        available={baseAvailable}
        locked={baseLocked}
        usdValue={baseUsd}
      />
      <AssetSection
        currency="USDT"
        total={usdtTotal}
        available={usdtAvailable}
        locked={usdtLocked}
        usdValue={usdtTotal}
      />
    </View>
  );
}

export const AssetsPanel = memo(AssetsPanelComponent);

const SECTION_PADDING = 20;

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
  // Pulls out over the order view's own 12px gutter so each section is genuinely full-width and the
  // dividers run edge to edge; the gutter is restored inside each section instead.
  panel: {
    marginHorizontal: -spacing.md,
  },
  loading: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginHorizontal: SECTION_PADDING,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.downFill,
    borderRadius: radius.sm,
  },
  errorText: {
    flex: 1,
    color: colors.downText,
    fontSize: 12,
    fontWeight: "600",
  },
  retryText: {
    color: colors.downText,
    fontSize: 12,
    fontWeight: "700",
  },
  section: {
    paddingHorizontal: SECTION_PADDING,
    paddingVertical: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 16,
  },
  symbol: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  balance: {
    gap: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  rowTop: {
    alignItems: "flex-start",
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
  },
  valueCol: {
    alignItems: "flex-end",
    gap: 1,
    flexShrink: 1,
  },
  value: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    textAlign: "right",
    flexShrink: 1,
  },
  subValue: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  valueUnavailable: {
    color: colors.textFaint,
    fontWeight: "500",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  }),
);
