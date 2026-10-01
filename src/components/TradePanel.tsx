import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";

import { CaretDownIcon, CaretUpIcon, PlusIcon } from "@/components/Icons";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { useSymbolRules } from "@/hooks/useSymbolRules";
import { describeError } from "@/lib/kucoin/errors";
import { fetchOrderBookSnapshot } from "@/lib/kucoin/level2";
import {
  createClientOid,
  placeLimitOrder,
  TEST_MODE,
} from "@/lib/kucoin/orders";
import { validateLimitOrder } from "@/lib/kucoin/orderRules";
import type { OrderSide } from "@/lib/kucoin/types";
import {
  FILL_STOPS,
  fillByPercent,
  maxSize,
  prefillPrice,
  sizeFromTotal,
  stepAmount,
  totalFromSize,
  type FillPercent,
} from "@/lib/trade";
import { colors, radius, spacing } from "@/theme";
import { trackPlacedOrder } from "@/state/openOrders";
import { formatAmount } from "@/utils/format";

type Props = {
  symbol: string;
  /** Override the app-wide `TEST_MODE` for this panel. */
  testMode?: boolean;
  /**
   * A price picked elsewhere, e.g. a tap on a row of the order book. Applied whenever `id`
   * changes, so the same price tapped twice still refills the field.
   */
  priceSelection?: ExternalPriceSelection | null;
};

export type ExternalPriceSelection = { id: number; value: string };

type Toast = { tone: "success" | "error"; message: string };

/** Keeps only digits and a single decimal point, so a stray paste cannot reach the math. */
function sanitizeAmount(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return `${cleaned.slice(0, firstDot + 1)}${cleaned.slice(firstDot + 1).replace(/\./g, "")}`;
}

function TradePanelBase({
  symbol,
  testMode = TEST_MODE,
  priceSelection,
}: Props) {
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
  const [isFetchingBestPrice, setIsFetchingBestPrice] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  /** Drops the slider position, so the next touch on a stop recomputes even if it is the same stop. */
  const clearPercent = useCallback(() => {
    appliedStopRef.current = null;
    setPercent(null);
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
    setInlineError(null);
    setToast(null);
    setIsFetchingBestPrice(false);
  }

  // A price tapped in the order book fills Price with the row's value, and re-runs the total when
  // an amount is already entered so the two stay in step as if Price had been typed. Applied
  // during render rather than in an effect: this is a prop changing, not an external
  // subscription, and doing it in an effect would cost a second commit per tap.
  const [appliedSelectionId, setAppliedSelectionId] = useState<number | null>(
    null,
  );
  if (priceSelection && priceSelection.id !== appliedSelectionId) {
    setAppliedSelectionId(priceSelection.id);
    setPrice(priceSelection.value);
    setPercent(null);
    setInlineError(null);
    if (size) setTotal(totalFromSize(priceSelection.value, size) ?? "");
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const baseAvailable = available[baseCurrency] ?? "0";
  const quoteAvailable = available[quoteCurrency] ?? "0";
  const availableForSide = side === "buy" ? quoteAvailable : baseAvailable;
  const availableCurrency = side === "buy" ? quoteCurrency : baseCurrency;

  const max = rules
    ? maxSize(side, rules, price, {
        base: baseAvailable,
        quote: quoteAvailable,
      })
    : null;
  const maxLabel = side === "buy" ? "Max Buy" : "Max Sell";

  const syncTotal = (nextPrice: string, nextSize: string) => {
    setTotal(
      nextPrice && nextSize ? (totalFromSize(nextPrice, nextSize) ?? "") : "",
    );
  };

  const applyPercent = (next: FillPercent) => {
    // `price` and `symbol` and `side` are part of the key, so editing any of them, switching pairs or
    // flipping the side all count as a different fill and are never blocked by the guard below.
    const key = `${symbol}|${side}|${price}|${next}`;
    if (appliedStopRef.current === key) return;
    appliedStopRef.current = key;
    setPercent(next);
    setInlineError(null);
    if (!rules) return;
    const filled = fillByPercent(side, next, rules, price, {
      base: baseAvailable,
      quote: quoteAvailable,
    });
    if (!filled) return;
    setSize(filled.size);
    setTotal(filled.total);
  };

  const onTrackLayout = (event: LayoutChangeEvent) =>
    setTrackWidth(event.nativeEvent.layout.width);

  const onTrackTouch = (event: GestureResponderEvent) => {
    if (trackWidth <= 0) return;
    const ratio = Math.min(
      1,
      Math.max(0, event.nativeEvent.locationX / trackWidth),
    );
    applyPercent(FILL_STOPS[Math.round(ratio * (FILL_STOPS.length - 1))]!);
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
   * Fills Price with the best price on the book the order would trade against, and only when the
   * user asks for it.
   *
   * On demand rather than continuously, because a field that rewrites itself while someone is
   * typing is a field that cannot be trusted: it was the reason this value used to arrive as a
   * ticking prop and re-render the entire form several times a second.
   *
   * A buy lifts the best ask, the lowest price someone is willing to sell at. A sell lifts the best
   * bid, the highest price someone will pay. Both are read from a one-off REST snapshot rather than
   * the live Level 2 socket: the store drops its book as soon as nothing is subscribed, so a value
   * taken from it after the user has been reading the form would often be missing.
   */
  const applyBestPrice = async () => {
    if (!rules || isFetchingBestPrice) return;
    setIsFetchingBestPrice(true);
    setInlineError(null);
    try {
      const snapshot = await fetchOrderBookSnapshot(symbol);
      // Asks are sorted best-first by the parser, so the first entry is the one to lift.
      const best = side === "buy" ? snapshot.asks[0] : snapshot.bids[0];
      if (!best) {
        setInlineError(
          `No ${side === "buy" ? "sell" : "buy"} orders on the book for ${symbol}.`,
        );
        return;
      }
      const next = prefillPrice(rules, Number(best.price));
      if (next === null) {
        setInlineError("Could not read the best price.");
        return;
      }
      setPrice(next);
      clearPercent();
      syncTotal(next, size);
    } catch (caught) {
      setInlineError(describeError(caught, "Could not load the best price."));
    } finally {
      setIsFetchingBestPrice(false);
    }
  };

  const submit = async () => {
    if (!rules || isSubmitting) return;
    setInlineError(null);
    const check = validateLimitOrder({ side, symbol, price, size }, rules, {
      base: baseAvailable,
      quote: quoteAvailable,
    });
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
      const verb = side === "buy" ? "Buy" : "Sell";
      setToast({
        tone: "success",
        message: `${testMode ? "Test " : ""}${verb} order placed · ${placed.orderId.slice(0, 8)}`,
      });
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
        labelAction={
          <Pressable
            onPress={applyBestPrice}
            // Blocked while an order is in flight so a late reply cannot overwrite the amount the
            // user is already submitting.
            disabled={!rules || isSubmitting || isFetchingBestPrice}
            hitSlop={8}
            style={[
              styles.bestPrice,
              (!rules || isSubmitting || isFetchingBestPrice) &&
                styles.bestPriceDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Use the best ${side === "buy" ? "ask" : "bid"} price`}
            accessibilityState={{ busy: isFetchingBestPrice }}
          >
            {isFetchingBestPrice ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={styles.bestPriceText}>Best Price</Text>
            )}
          </Pressable>
        }
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

      <View style={styles.sliderWrapper}>
        <View
          style={styles.slider}
          onLayout={onTrackLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onTrackTouch}
          onResponderMove={onTrackTouch}
          // The panel sits inside a ScrollView, which will otherwise ask to take the gesture over
          // mid-drag. Refusing makes the drag predictable and stops the two from fighting, which
          // read as lag.
          onResponderTerminationRequest={() => false}
          // Larger than the 8px track so the dots resting on the two ends, which hang half outside
          // it, are still fully tappable. A touch out past either end reports a locationX below 0 or
          // above the width, which `onTrackTouch` clamps to the two ends.
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="adjustable"
          accessibilityLabel="Amount percentage of available balance"
          accessibilityValue={{ min: 0, max: 100, now: percent ?? 0 }}
        >
          <View style={styles.sliderTrack} />
          <View
            style={[styles.sliderFill, { width: `${percent ?? 0}%` }]}
          />
          {FILL_STOPS.map((stop) => {
            const active = percent !== null && stop <= percent;
            return (
              <View
                key={stop}
                style={[
                  styles.dot,
                  { left: `${stop}%` },
                  active && styles.dotActive,
                ]}
              />
            );
          })}
        </View>
      </View>

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

      {rulesError ? <Text style={styles.error}>{rulesError}</Text> : null}
      {inlineError ? <Text style={styles.error}>{inlineError}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={!rules || isSubmitting}
        style={[
          styles.action,
          side === "buy" ? styles.actionBuy : styles.actionSell,
          (!rules || isSubmitting) && styles.actionDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${side === "buy" ? "Buy" : "Sell"} ${baseCurrency}`}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
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
  /** Rendered on the right of the label row, e.g. the Best Price action. */
  labelAction?: ReactNode;
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
  labelAction,
}: AmountFieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {labelAction}
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          keyboardType="decimal-pad"
          editable={editable}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel={label}
        />
        <Text style={styles.unit}>{unit}</Text>
        <View style={styles.steppers}>
          <Pressable
            onPress={onStepUp}
            disabled={!editable}
            hitSlop={6}
            style={styles.stepper}
            accessibilityRole="button"
            accessibilityLabel={`Increase ${label}`}
          >
            <CaretUpIcon size={12} color={colors.textMuted} />
          </Pressable>
          <Pressable
            onPress={onStepDown}
            disabled={!editable}
            hitSlop={6}
            style={styles.stepper}
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${label}`}
          >
            <CaretDownIcon size={12} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The parent owns the padding, and this column is stretched to the height of the taller one
  // beside it, so the content spreads to fill rather than sitting in a scroll view of its own.
  content: {
    flex: 1,
    gap: spacing.sm,
  },
  toast: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  toastOk: {
    backgroundColor: "rgba(35,175,137,0.16)",
  },
  toastError: {
    backgroundColor: "rgba(246,70,93,0.16)",
  },
  toastText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "600",
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 2,
    gap: 2,
  },
  tab: {
    flex: 1,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
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
    color: "#FFFFFF",
  },
  tabTextSell: {
    color: "#FFFFFF",
  },
  field: {
    gap: 4,
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
  bestPrice: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  bestPriceDisabled: {
    opacity: 0.5,
  },
  bestPriceText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "700",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingLeft: spacing.sm,
    paddingRight: 6,
    height: 38,
    gap: 6,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    padding: 0,
  },
  unit: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  steppers: {
    justifyContent: "center",
    gap: 1,
  },
  stepper: {
    paddingHorizontal: 2,
  },
  sliderWrapper: {
    marginTop: 12,
    marginBottom: 12,
    // The only inset. The track, the fill, the dots and the tap maths all share the width measured
    // inside it, so a touch lands exactly on the dot that was pressed.
    paddingHorizontal: 12,
  },
  slider: {
    height: 12,
    justifyContent: "center",
  },
  sliderTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    top: "50%",
    marginTop: -4,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  dot: {
    position: "absolute",
    width: 16,
    height: 16,
    // Centred on its own stop, so the dot's middle is the position the fill grows to.
    top: "50%",
    marginTop: -8,
    marginLeft: -8,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  dotActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
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
    backgroundColor: "rgba(35,175,137,0.16)",
  },
  error: {
    color: colors.down,
    fontSize: 11,
    lineHeight: 15,
  },
  action: {
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    // Absorbs whatever height the book column leaves this one short by, so the button sits on the
    // bottom edge of the section and both columns finish at the same line.
    marginTop: "auto",
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
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  rulesLoader: {
    marginTop: 2,
  },
});
