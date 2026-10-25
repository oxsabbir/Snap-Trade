import { memo } from "react";
import { Pressable, View } from "@/components/AppLayout";
import { StyleSheet } from "react-native";
import { Text } from "@/components/AppText";

import { useAccountBalance } from "@/hooks/useAccountBalance";
import { maxSize } from "@/lib/trade";
import type { DepthRow } from "@/lib/kucoin/orderbook";
import type { SymbolInfo } from "@/lib/kucoin/types";
import { compareDecimal, multiplyDecimal } from "@/utils/decimal";
import { decimalsFromIncrement, formatPrice } from "@/utils/format";
import { spacing } from "@/theme";
import { createThemedStyles } from "@/theme/themedStyles";

type Props = {
  asks: DepthRow[];
  quoteCurrency: string;
  rules: SymbolInfo | null;
  feeRate: string;
  onSelect: (price: string, size: string) => void;
};

const PRESET_COUNT = 5;

function QuickBuyBase({
  asks,
  quoteCurrency,
  rules,
  feeRate,
  onSelect,
}: Props) {
  const styles = useStyles();
  const { available } = useAccountBalance();
  const quoteAvailable = available[quoteCurrency] ?? "0";
  const basePrice = asks[0] ? Number(asks[0].price) : null;

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
                { base: "0", quote: quoteAvailable },
                feeRate,
              )
            : null;
        // Uses full 100% (All) available balance at this ask price ceiling
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
        const minimumTotal = rules
          ? (compareDecimal(rules.minFunds, rules.quoteMinSize) ?? 0) > 0
            ? rules.minFunds
            : rules.quoteMinSize
          : null;
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
        const slippagePct =
          basePrice && basePrice > 0
            ? ((rowPrice - basePrice) / basePrice) * 100
            : 0;

        return (
          <Pressable
            key={index}
            onPress={() => row && size && onSelect(row.price, size)}
            disabled={!enabled}
            style={[styles.button, !enabled && styles.buttonDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !enabled }}
            accessibilityLabel={
              row
                ? `Quick buy at ${row.price}, estimated ${ratio.toFixed(0)} percent of maximum buy size`
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
