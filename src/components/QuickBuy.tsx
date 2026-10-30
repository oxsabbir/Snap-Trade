import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, View } from "@/components/AppLayout";
import { StyleSheet } from "react-native";
import { Text } from "@/components/AppText";

import { useAccountBalance } from "@/hooks/useAccountBalance";
import { useOpenOrders } from "@/hooks/useOpenOrders";
import { isPositive, maxSize } from "@/lib/trade";
import type { DepthRow } from "@/lib/kucoin/orderbook";
import type { SymbolInfo } from "@/lib/kucoin/types";
import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal } from "@/utils/decimal";
import { decimalsFromIncrement, formatPrice } from "@/utils/format";
import { spacing } from "@/theme";
import { createThemedStyles } from "@/theme/themedStyles";
import { cancelOpenOrder, isTerminalStatus } from "@/state/openOrders";
import { awaitBalanceRefresh } from "@/state/balance";

type Props = {
  symbol: string;
  asks: DepthRow[];
  quoteCurrency: string;
  rules: SymbolInfo | null;
  feeRate: string;
  onSelect: (price: string, size: string) => void;
};

const PRESET_COUNT = 5;

/** The quote minimum a new order must clear — `minFunds` when set, the size-based one otherwise. */
function quoteMinimum(rules: SymbolInfo | null): string | null {
  if (!rules) return null;
  return (compareDecimal(rules.minFunds, rules.quoteMinSize) ?? 0) > 0
    ? rules.minFunds
    : rules.quoteMinSize;
}

function QuickBuyBase({
  symbol,
  asks,
  quoteCurrency,
  rules,
  feeRate,
  onSelect,
}: Props) {
  const styles = useStyles();
  const { available } = useAccountBalance();
  const { orders } = useOpenOrders();
  const [replacing, setReplacing] = useState(false);
  const quoteAvailable = available[quoteCurrency] ?? "0";

  /**
   * Buy orders this pair still has sitting in the book. Their unfilled remainder is quote
   * currency frozen by the exchange: it shows in neither `available` nor `holds` as spendable,
   * and it cannot fund anything until the order leaves the book — which is exactly why the tap
   * below offers to free it.
   */
  const pendingBuys = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.symbol === symbol &&
          order.side === "buy" &&
          !isTerminalStatus(order.status),
      ),
    [orders, symbol],
  );

  /**
   * Everything a follow-up buy can reach: the free balance plus what the open orders would
   * release if cancelled. Sizing against this total instead of `available` alone is what keeps
   * the rows live while an unfilled order sits on the whole balance.
   */
  const potentialQuote = useMemo(() => {
    let frozen = "0";
    for (const order of pendingBuys) {
      const remainder = subtractDecimal(order.size, order.filledSize);
      if (!remainder || (compareDecimal(remainder, "0") ?? 0) <= 0) continue;
      const held = multiplyDecimal(remainder, order.price);
      if (held) frozen = addDecimal(frozen, held) ?? frozen;
    }
    return addDecimal(quoteAvailable, frozen) ?? quoteAvailable;
  }, [pendingBuys, quoteAvailable]);

  const handleSelect = useCallback(
    async (row: DepthRow, size: string) => {
      if (replacing) return;

      // Nothing of ours in the book: this is the plain path — the selection just fills the form.
      if (pendingBuys.length === 0 || !rules) {
        onSelect(row.price, size);
        return;
      }

      /**
       * Replace, not double-buy. KuCoin has no order amendment, so the only way to reach the
       * frozen remainder is cancel-then-replace — the tap the user makes when they want a new
       * price does both, and the already-filled part of the old order is never re-bought: its
       * base converted into the account at fill time and is separately owned.
       */
      setReplacing(true);
      try {
        const settled = await Promise.all(
          pendingBuys.map((order) => cancelOpenOrder(order.orderId)),
        );
        // A cancel that could not be confirmed leaves whether its funds came back unknown, and
        // sizing against a balance that may not exist is how an order gets rejected or buys
        // with money still spoken for. Leave the flow; the row can be tapped again.
        if (settled.some((ok) => !ok)) return;

        // Read the balance after the release lands rather than trusting the pre-cancel snapshot.
        const fresh = (await awaitBalanceRefresh()).available[quoteCurrency] ?? "0";
        const minimum = quoteMinimum(rules);
        if (
          !isPositive(fresh) ||
          minimum === null ||
          (compareDecimal(fresh, minimum) ?? -1) < 0
        ) {
          // Nothing spendable came back — the rest of the old order filled while the cancel ran,
          // so there is no follow-up order to place.
          return;
        }
        onSelect(row.price, size);
      } finally {
        setReplacing(false);
      }
    },
    [onSelect, pendingBuys, quoteCurrency, replacing, rules],
  );

  return (
    <View style={styles.container}>
      {Array.from({ length: PRESET_COUNT }, (_, index) => {
        // Reverse the five visible ask levels to match the order book: highest at the top.
        const askLevel = PRESET_COUNT - index;
        const row = asks[askLevel - 1];
        const affordable =
          row && rules
            ? maxSize(
                "buy",
                rules,
                row.price,
                { base: "0", quote: potentialQuote },
                feeRate,
              )
            : null;
        // Filled against the reachable balance, so the bar reads the same with or without an
        // open order holding part of it.
        const size = affordable;
        const ratio =
          row &&
          affordable !== null &&
          (compareDecimal(affordable, "0") ?? 0) > 0
            ? Math.max(
                0,
                Math.min(100, (Number(row.total) / Number(affordable)) * 100),
              )
            : 0;
        const priceTotal =
          row && size !== null ? multiplyDecimal(row.price, size) : null;
        const minimumTotal = quoteMinimum(rules);
        const enabled = Boolean(
          row &&
          rules &&
          size !== null &&
          affordable !== null &&
          (compareDecimal(size, rules.baseMinSize) ?? -1) >= 0 &&
          priceTotal !== null &&
          minimumTotal !== null &&
          (compareDecimal(priceTotal, minimumTotal) ?? -1) >= 0,
        );

        const rowPrice = row ? Number(row.price) : 0;
        const basePrice = asks[0] ? Number(asks[0].price) : null;
        const slippagePct =
          basePrice && basePrice > 0
            ? ((rowPrice - basePrice) / basePrice) * 100
            : 0;

        return (
          <Pressable
            key={index}
            onPress={() => {
              if (row && size !== null) void handleSelect(row, size);
            }}
            disabled={!enabled || replacing}
            style={[styles.button, !enabled && styles.buttonDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !enabled || replacing }}
            accessibilityLabel={
              row
                ? pendingBuys.length > 0
                  ? `Replace open order with a buy at ${row.price}, using the balance it frees`
                  : `Quick buy at ${row.price}, estimated ${ratio.toFixed(0)} percent of maximum buy size`
                : `Quick buy price ${askLevel} loading`
            }
          >
            <View style={[styles.fill, { width: `${ratio}%` }]} />
            <View style={styles.buttonContent}>
              <View style={styles.priceRow}>
                <Text style={styles.price} numberOfLines={1}>
                  {row
                    ? formatPrice(
                        Number(row.price),
                        decimalsFromIncrement(
                          rules?.priceIncrement ?? "0.000001",
                        ),
                      )
                    : "—"}
                </Text>
                {row ? (
                  <Text
                    style={[
                      styles.slippage,
                      slippagePct >= 5 && styles.slippageWarning,
                      slippagePct >= 10 && styles.slippageDanger,
                    ]}
                    numberOfLines={1}
                  >
                    {slippagePct >= 10 ? "⚠️ +" : "+"}
                    {slippagePct === 0
                      ? "0.0%"
                      : slippagePct < 1
                        ? `${slippagePct.toFixed(2)}%`
                        : slippagePct < 10
                          ? `${slippagePct.toFixed(1)}%`
                          : `${Math.round(slippagePct)}%`}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.percentage}>
                {row ? `${ratio.toFixed(0)}%` : "—"}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export const QuickBuy = memo(QuickBuyBase);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "space-between",
      gap: spacing.xs,
    },
    button: {
      flex: 1,
      minHeight: 20,
      justifyContent: "center",
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    fill: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: colors.quickBarBG,
    },
    buttonContent: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    priceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      flex: 1,
    },
    price: {
      color: colors.upText,
      fontSize: 12,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    slippage: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    slippageWarning: {
      color: colors.warning,
      fontWeight: "700",
    },
    slippageDanger: {
      color: colors.downText,
      fontWeight: "800",
    },
    percentage: {
      color: colors.upText,
      fontSize: 10,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
  }),
);
