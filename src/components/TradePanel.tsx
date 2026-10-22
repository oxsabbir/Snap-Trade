import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "@/components/AppLayout";
import { ActivityIndicator, StyleSheet } from "react-native";
import { Text, TextInput } from "@/components/AppText";

import { PlusIcon } from "@/components/Icons";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { useSymbolRules } from "@/hooks/useSymbolRules";
import { describeError } from "@/lib/kucoin/errors";
import {
  createClientOid,
  placeLimitOrder,
  TEST_MODE,
} from "@/lib/kucoin/orders";
import { validateLimitOrder } from "@/lib/kucoin/orderRules";
import type { OrderSide } from "@/lib/kucoin/types";
import {
  fillByPercent,
  isPositive,
  maxSize,
  sizeFromTotal,
  stepAmount,
  totalFromSize,
  type FillPercent,
} from "@/lib/trade";
import { radius, spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";
import { trackPlacedOrder } from "@/state/openOrders";
import { formatAmount } from "@/utils/format";
import { useFontScale } from "@/theme/FontScaleProvider";

type Props = {
  symbol: string;
  takerFeeRate: string | null;
  /** Override the app-wide `TEST_MODE` for this panel. */
  testMode?: boolean;
  /** A price picked elsewhere, e.g. a tap on a row of the order book. */
  priceSelection?: ExternalPriceSelection | null;
};

export type ExternalPriceSelection = {
  id: number;
  value: string;
  size?: string;
  side?: OrderSide;
};

type Toast = { tone: "success" | "error"; message: string };

/** Keeps only digits and a single decimal point, so a stray paste cannot reach the math. */
function sanitizeAmount(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, "")}`;
}

// Percentage chip stops (0%, 25%, 50%, 75%, 100%)
const PERCENT_CHIPS = [0, 25, 50, 75, 100] as const;

interface PercentChipsProps {
  value: FillPercent | null;
  activeChip: number | null;
  onChange: (value: FillPercent) => void;
  enabled: boolean;
  side: OrderSide;
}

function PercentChips({
  value,
  activeChip,
  onChange,
  enabled,
  side,
}: PercentChipsProps) {
  const { colors } = useTheme();
  const { scale } = useFontScale();
  const styles = useStyles();
  const accentColor = side === "buy" ? colors.up : colors.down;
  const compact = scale >= 1.075;

  return (
    <View style={styles.percentSection}>
      <Text style={styles.fieldLabel}>Spot Size</Text>
      <View
        style={[styles.chipContainer, compact && styles.chipContainerCompact]}
      >
        {PERCENT_CHIPS.map((chip) => {
          const isActive = activeChip === chip;
          return (
            <Pressable
              key={chip}
              onPress={() => enabled && onChange(chip)}
              disabled={!enabled}
              hitSlop={8}
              style={[
                styles.chip,
                compact && styles.chipCompact,
                isActive ? styles.chipActive : styles.chipInactive,
                isActive && { backgroundColor: accentColor },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, disabled: !enabled }}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.chipText,
                  compact && styles.chipTextCompact,
                  isActive ? styles.chipTextActive : styles.chipTextInactive,
                  !enabled && styles.chipTextDisabled,
                ]}
              >
                {chip === 100 ? "All" : `${chip}%`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TradePanelBase({
  symbol,
  takerFeeRate,
  testMode = TEST_MODE,
  priceSelection,
}: Props) {
  const { colors } = useTheme();
  const { scale } = useFontScale();
  const styles = useStyles();
  const [baseCurrency = "", quoteCurrency = ""] = symbol.split("-");

  const {
    rules,
    isLoading: rulesLoading,
    error: rulesError,
  } = useSymbolRules(symbol);
  // Read from the shared balance store, so a cancel driven from the order list below updates the
  // number here instead of leaving a second, independently fetched copy behind. The same store is
  // written by `/account/balance`, so a change made on the desktop moves this too.
  const { available } = useAccountBalance();

  const [side, setSide] = useState<OrderSide>("buy");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [total, setTotal] = useState("");
  const [percent, setPercent] = useState<FillPercent | null>(null);
  const [pendingAllSelectionId, setPendingAllSelectionId] = useState<
    number | null
  >(null);
  /**
   * The stop last handed to the fill math, keyed by pair and side so a move to another market or to
   * the other side of the book is never mistaken for one already applied.
   *
   * A drag emits a touch move per frame, but it only ever lands on one of five stops, so without
   * this guard the decimal arithmetic below would run on every one of those frames and discard
   * all but the last result. Kept in a ref because moves arrive faster than React commits, so
   * `percent` state would still read stale and the guard would never trip.
   */
  const appliedStopRef = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  /** Drops the selected percentage, so the next tap on a chip recomputes even if it is the same chip. */
  const clearPercent = useCallback(() => {
    appliedStopRef.current = null;
    setPercent(null);
    setPendingAllSelectionId(null);
  }, []);

  // Reset on a pair change during render so the form never carries the previous pair's amounts.
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  if (symbol !== activeSymbol) {
    setActiveSymbol(symbol);
    setSide("buy");
    setPrice("");
    setSize("");
    setTotal("");
    setPercent(null);
    setPendingAllSelectionId(null);
    setInlineError(null);
    setToast(null);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3505);
    return () => clearTimeout(timer);
  }, [toast]);

  const baseAvailable = available[baseCurrency] ?? "0";
  const quoteAvailable = available[quoteCurrency] ?? "0";
  const availableForSide = side === "buy" ? quoteAvailable : baseAvailable;
  const availableCurrency = side === "buy" ? quoteCurrency : baseCurrency;

  // User-specific fee rate (base class rate × VIP coefficient × KCS 20% discount)
  const effectiveFeeRate = takerFeeRate ?? "0.001";

  // A book tap always updates Price. On Buy it also selects the full available balance; on Sell it
  // leaves the entered amount alone and only recalculates Total.
  // Applied during render rather than in an effect: this is a prop change, not a subscription.
  const [appliedSelectionId, setAppliedSelectionId] = useState<number | null>(
    null,
  );
  if (priceSelection && priceSelection.id !== appliedSelectionId) {
    setAppliedSelectionId(priceSelection.id);
    setPrice(priceSelection.value);
    const selectionSide = priceSelection.side ?? side;
    if (priceSelection.side) setSide(priceSelection.side);
    if (selectionSide === "buy") {
      // Selecting a book price on Buy opts into the full available balance (All / 100%) at that price.
      setPercent(100);
      setPendingAllSelectionId(priceSelection.id);
      if (rules) {
        const filled = fillByPercent(
          selectionSide,
          100,
          rules,
          priceSelection.value,
          { base: baseAvailable, quote: quoteAvailable },
          effectiveFeeRate,
        );
        if (filled) {
          setSize(filled.size);
          setTotal(filled.total);
        }
      } else if (priceSelection.size) {
        setSize(priceSelection.size);
        setTotal(totalFromSize(priceSelection.value, priceSelection.size) ?? "");
      }
    } else {
      setPercent(null);
      setPendingAllSelectionId(null);
      setTotal(size ? totalFromSize(priceSelection.value, size) ?? "" : "");
    }
    setInlineError(null);
  }

  // A book tap can happen before the pair rules arrive. Keep the 100% selection pending and
  // calculate it as soon as the rules and current available balance are ready.
  if (
    pendingAllSelectionId !== null &&
    priceSelection?.id === pendingAllSelectionId &&
    rules
  ) {
    const filled = fillByPercent(
      side,
      100,
      rules,
      priceSelection.value,
      { base: baseAvailable, quote: quoteAvailable },
      effectiveFeeRate,
    );
    if (filled) {
      setPercent(100);
      setSize(filled.size);
      setTotal(filled.total);
    }
    setPendingAllSelectionId(null);
  }

  useEffect(() => {
    if (side === "sell" && priceSelection?.id === appliedSelectionId) {
      appliedStopRef.current = null;
    }
  }, [side, priceSelection?.id, appliedSelectionId]);

  const max = rules
    ? maxSize(
        side,
        rules,
        price,
        {
          base: baseAvailable,
          quote: quoteAvailable,
        },
        effectiveFeeRate,
      )
    : null;
  const maxLabel = side === "buy" ? "Max Buy" : "Max Sell";

  const syncTotal = (nextPrice: string, nextSize: string) => {
    setTotal(
      nextPrice && nextSize ? (totalFromSize(nextPrice, nextSize) ?? "") : "",
    );
  };

  /**
   * The slider spends a percentage of the balance, so it is only meaningful once the two things that
   * percentage is measured against both exist: a price to spend at, and a balance to spend from.
   *
   * Without them `fillByPercent` returns nothing, so the handle used to slide while Amount and Total
   * stayed empty, which read as a broken control rather than an incomplete one. Naming the missing
   * piece keeps the reason visible instead of leaving a dead slider to guess at.
   */
  const hasPrice = isPositive(price);
  const hasBalance = isPositive(availableForSide);
  const chipBlocker = !rules
    ? "Loading pair rules"
    : !hasBalance
      ? `No ${availableCurrency} available to ${side === "buy" ? "buy" : "sell"}`
      : !hasPrice
        ? "Enter a price first"
        : null;
  const chipEnabled = chipBlocker === null && !isSubmitting;

  const applyPercent = (next: FillPercent) => {
    // `price` and `symbol` and `side` are part of the key, so editing any of them, switching pairs or
    // flipping the side all count as a different fill and are never blocked by the guard below.
    const key = `${symbol}|${side}|${price}|${next}`;
    if (appliedStopRef.current === key) return;
    appliedStopRef.current = key;
    setPercent(next);
    setInlineError(null);
    if (!rules) return;
    const filled = fillByPercent(
      side,
      next,
      rules,
      price,
      {
        base: baseAvailable,
        quote: quoteAvailable,
      },
      effectiveFeeRate,
    );
    if (!filled) return;
    setSize(filled.size);
    setTotal(filled.total);
  };

  const onPriceChange = (text: string) => {
    const clean = sanitizeAmount(text);
    setPrice(clean);
    clearPercent();
    setInlineError(null);
    syncTotal(clean, size);
  };

  const onSizeChange = (text: string) => {
    const clean = sanitizeAmount(text);
    setSize(clean);
    clearPercent();
    setInlineError(null);
    syncTotal(price, clean);
  };

  const onTotalChange = (text: string) => {
    const clean = sanitizeAmount(text);
    setTotal(clean);
    clearPercent();
    setInlineError(null);
    if (!clean) {
      setSize("");
      return;
    }
    const derived = rules ? sizeFromTotal(clean, price, rules) : null;
    if (derived !== null) setSize(derived);
  };

  const onStep = (field: "price" | "size" | "total", direction: 1 | -1) => {
    if (!rules) return;
    clearPercent();
    setInlineError(null);
    if (field === "price") {
      const next = stepAmount(price, rules.priceIncrement, direction);
      setPrice(next);
      syncTotal(next, size);
      return;
    }
    if (field === "size") {
      const next = stepAmount(size, rules.baseIncrement, direction);
      setSize(next);
      syncTotal(price, next);
      return;
    }
    const next = stepAmount(total, rules.priceIncrement, direction);
    setTotal(next);
    const derived = sizeFromTotal(next, price, rules);
    if (derived !== null) setSize(derived);
  };

  const switchSide = (next: OrderSide) => {
    setSide(next);
    clearPercent();
    setInlineError(null);
  };

  /**
   * Determines which chip (if any) should appear active based on the current Amount value.
   * Returns the matching percentage or null if no chip matches exactly.
   * Memoized so the 6 fillByPercent calls run only when deps change, not every render.
   */
  const activeChip = useMemo((): number | null => {
    if (!rules || !hasPrice || !hasBalance || size === "") return null;
    const filled = fillByPercent(
      side,
      percent!,
      rules,
      price,
      {
        base: baseAvailable,
        quote: quoteAvailable,
      },
      effectiveFeeRate,
    );
    if (!filled) return null;
    // Check if current size matches any chip's calculated size exactly
    for (const chip of PERCENT_CHIPS) {
      const chipFilled = fillByPercent(
        side,
        chip,
        rules,
        price,
        {
          base: baseAvailable,
          quote: quoteAvailable,
        },
        effectiveFeeRate,
      );
      if (chipFilled && chipFilled.size === size) return chip;
    }
    return null;
  }, [
    rules,
    hasPrice,
    hasBalance,
    size,
    percent,
    side,
    price,
    baseAvailable,
    quoteAvailable,
    effectiveFeeRate,
  ]);

  const submit = async () => {
    if (!rules || isSubmitting) return;
    setInlineError(null);
    const check = validateLimitOrder(
      { side, symbol, price, size },
      rules,
      {
        base: baseAvailable,
        quote: quoteAvailable,
      },
      effectiveFeeRate,
    );
    if (!check.valid || !check.normalized) {
      setInlineError(
        check.issues[0]?.message ?? "Enter a valid price and amount.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const clientOid = createClientOid();
      const placed = await placeLimitOrder(
        {
          clientOid,
          side,
          symbol,
          price: check.normalized.price,
          size: check.normalized.size,
        },
        { test: testMode },
      );
      // Show it in the open-orders list on this tap rather than after its next poll. A dry run
      // returns an id the exchange never created, so there is nothing real to list.
      //
      // This also refreshes the balance, since placing freezes the funds immediately. A dry run
      // moves no funds, so it needs no refresh either.
      if (!testMode) {
        trackPlacedOrder(
          { orderId: placed.orderId, clientOid },
          {
            symbol,
            side,
            price: check.normalized.price,
            size: check.normalized.size,
          },
        );
      }
      setToast(null);
      setSize("");
      setTotal("");
      clearPercent();
    } catch (caught) {
      setToast({
        tone: "error",
        message: describeError(caught, "Order failed."),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const editable = !!rules && !isSubmitting;

  return (
    <View style={styles.content}>
      {toast ? (
        <View
          style={[
            styles.toast,
            toast.tone === "success" ? styles.toastOk : styles.toastError,
          ]}
        >
          <Text style={styles.toastText} numberOfLines={2}>
            {toast.message}
          </Text>
        </View>
      ) : null}

      <View style={styles.toggle}>
        <Pressable
          onPress={() => switchSide("buy")}
          style={[styles.tab, side === "buy" && styles.tabBuy]}
          accessibilityRole="button"
          accessibilityState={{ selected: side === "buy" }}
        >
          <Text style={[styles.tabText, side === "buy" && styles.tabTextBuy]}>
            Buy
          </Text>
        </Pressable>
        <Pressable
          onPress={() => switchSide("sell")}
          style={[styles.tab, side === "sell" && styles.tabSell]}
          accessibilityRole="button"
          accessibilityState={{ selected: side === "sell" }}
        >
          <Text style={[styles.tabText, side === "sell" && styles.tabTextSell]}>
            Sell
          </Text>
        </Pressable>
      </View>

      <AmountField
        label="Price"
        value={price}
        placeholder={rules ? rules.priceIncrement : "0"}
        unit={quoteCurrency}
        editable={editable}
        onChangeText={onPriceChange}
        onStepUp={() => onStep("price", 1)}
        onStepDown={() => onStep("price", -1)}
      />

      <AmountField
        label="Amount"
        value={size}
        placeholder={rules ? `Minimum: ${rules.baseMinSize}` : "0"}
        unit={baseCurrency}
        editable={editable}
        onChangeText={onSizeChange}
        onStepUp={() => onStep("size", 1)}
        onStepDown={() => onStep("size", -1)}
      />

      <PercentChips
        value={percent}
        activeChip={activeChip}
        onChange={applyPercent}
        enabled={chipEnabled}
        side={side}
      />

      <AmountField
        label="Total"
        value={total}
        placeholder={rules ? `Minimum: ${rules.minFunds}` : "0"}
        unit={quoteCurrency}
        editable={editable}
        onChangeText={onTotalChange}
        onStepUp={() => onStep("total", 1)}
        onStepDown={() => onStep("total", -1)}
      />

      <View style={styles.footer}>
        <View style={styles.summaryRows}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Available</Text>
            <View style={styles.rowValueWrap}>
              <Text style={styles.rowValue}>
                {formatAmount(Number(availableForSide))} {availableCurrency}
              </Text>
              <Pressable
                onPress={() => undefined}
                hitSlop={8}
                style={styles.deposit}
                accessibilityRole="button"
                accessibilityLabel={`Deposit ${availableCurrency}`}
              >
                <PlusIcon size={12} color={colors.accent} />
              </Pressable>
            </View>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>{maxLabel}</Text>
            <Text style={styles.rowValue}>
              {max === null ? "—" : `${formatAmount(Number(max))} ${baseCurrency}`}
            </Text>
          </View>
        </View>

        {rulesError ? <Text style={styles.error}>{rulesError}</Text> : null}
        {inlineError ? <Text style={styles.error}>{inlineError}</Text> : null}

        <Pressable
          onPress={submit}
          disabled={!rules || isSubmitting}
          hitSlop={12}
          style={[
            styles.action,
            scale === 1 && styles.actionDefaultSize,
            side === "buy" ? styles.actionBuy : styles.actionSell,
            (!rules || isSubmitting) && styles.actionDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${side === "buy" ? "Buy" : "Sell"} ${baseCurrency}`}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.actionText}>
              {side === "buy" ? "Buy" : "Sell"} {baseCurrency}
            </Text>
          )}
        </Pressable>

        {rulesLoading ? (
          <ActivityIndicator color={colors.accent} style={styles.rulesLoader} />
        ) : null}
      </View>
    </View>
  );
}

export const TradePanel = memo(TradePanelBase);

type AmountFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  unit: string;
  editable: boolean;
  onChangeText: (text: string) => void;
  onStepUp: () => void;
  onStepDown: () => void;
};

function AmountField({
  label,
  value,
  placeholder,
  unit,
  editable,
  onChangeText,
  onStepUp,
  onStepDown,
}: AmountFieldProps) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          keyboardAppearance={scheme === "dark" ? "dark" : "light"}
          keyboardType="decimal-pad"
          editable={editable}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel={label}
        />
        <View style={styles.stepperGroup}>
          <Pressable
            onPress={onStepDown}
            disabled={!editable}
            hitSlop={8}
            style={styles.stepperButton}
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${label}`}
          >
            <Text style={styles.stepperText}>−</Text>
          </Pressable>
          <Pressable
            onPress={onStepUp}
            disabled={!editable}
            hitSlop={8}
            style={styles.stepperButton}
            accessibilityRole="button"
            accessibilityLabel={`Increase ${label}`}
          >
            <Text style={styles.stepperText}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    // The parent owns the padding, and this column is stretched to the height of the taller one
    // beside it, so the content spreads to fill rather than sitting in a scroll view of its own.
    content: {
      flex: 1,
      gap: 10,
    },
    toast: {
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    toastOk: {
      backgroundColor: colors.upFill,
    },
    toastError: {
      backgroundColor: colors.downFill,
    },
    toastText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "600",
    },
    toggle: {
      flexDirection: "row",
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: 2,
      gap: 3,
    },
    tab: {
      flex: 1,
      minHeight: 29,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 5,
    },
    tabBuy: {
      backgroundColor: colors.up,
    },
    tabSell: {
      backgroundColor: colors.down,
    },
    tabText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: "700",
    },
    tabTextBuy: {
      color: colors.onAccent,
    },
    tabTextSell: {
      color: colors.onAccent,
    },
    field: {
      gap: 3,
    },
    fieldLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    fieldLabel: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.3,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 6,
      height: 36,
      gap: 6,
    },
    input: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
      padding: 0,
      paddingLeft: 4,
    },
    unit: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: "600",
    },
    stepperButton: {
      width: 24,
      height: 28,
      borderRadius: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bg,
    },
    stepperGroup: {
      flexDirection: "row",
      gap: 3,
    },
    stepperText: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.text,
    },
    chipContainer: {
      flexDirection: "row",
      backgroundColor: colors.surfaceAlt,
      borderRadius: 8,
      padding: 4,
      gap: 3,
      width: "100%",
      height: 44,
      alignItems: "stretch",
    },
    percentSection: {
      gap: 3,
    },
    chipContainerCompact: {
      padding: 3,
      gap: 3,
    },
    chip: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      paddingHorizontal: 4,
      paddingVertical: 2,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 5,
    },
    chipCompact: {
      paddingHorizontal: 1,
    },
    chipInactive: {
      backgroundColor: "transparent",
    },
    chipActive: {
      // backgroundColor set dynamically based on side (colors.up / colors.down)
    },
    chipDisabled: {
      opacity: 0.4,
    },
    chipText: {
      fontSize: 12,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    chipTextCompact: {
      letterSpacing: -0.2,
    },
    chipTextInactive: {
      color: colors.textMuted,
    },
    chipTextActive: {
      color: colors.onAccent,
    },
    chipTextDisabled: {
      color: colors.textFaint,
    },
    footer: {
      marginTop: "auto",
      gap: 6,
    },
    summaryRows: {
      gap: 4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    rowLabel: {
      color: colors.textMuted,
      fontSize: 11,
    },
    rowValueWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    rowValue: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    deposit: {
      width: 16,
      height: 16,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.upFill,
    },
    error: {
      color: colors.downText,
      fontSize: 11,
      lineHeight: 15,
    },
    action: {
      height: 38,
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
    },
    actionDefaultSize: {
      height: 42,
    },
    actionBuy: {
      backgroundColor: colors.up,
    },
    actionSell: {
      backgroundColor: colors.down,
    },
    actionDisabled: {
      opacity: 0.4,
    },
    actionText: {
      color: colors.onAccent,
      fontSize: 14,
      fontWeight: "700",
    },
    rulesLoader: {
      marginTop: 2,
    },
  }),
);
