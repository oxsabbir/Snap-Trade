import { memo, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { CoinInfoSheet } from "@/components/CoinInfoSheet";
import { InfoIcon } from "@/components/Icons";
import { LiveBadge } from "@/components/LiveBadge";
import { LivePrice } from "@/components/LivePrice";
import { PriceChart } from "@/components/PriceChart";
import { TimeframeTabs } from "@/components/TimeframeTabs";
import { useLifetimeSeries } from "@/hooks/useLifetimeSeries";
import { useLiveCandles } from "@/hooks/useLiveCandles";
import { useStableChartHeight } from "@/hooks/useStableChartHeight";
import {
  timeframeByKey,
  LINE_TIMEFRAME,
  type TimeframeOrLine,
} from "@/lib/kucoin/candles";
import { colors, radius, spacing } from "@/theme";

type Props = {
  symbol: string;
  name?: string;
  decimals?: number;
  /**
   * Sections rendered under the chart. The screen that renders this owns the scroll view and
   * the order of the sections, so anything added later is a sibling here rather than another
   * branch inside this component.
   *
   * Plain children, deliberately: this used to be a render prop handed the live quote, which
   * is what put a price ticking several times a second into state above the order book and the
   * order form. Neither reads the quote now — the price is subscribed to directly where it is
   * displayed — so there is nothing left to pass down.
   */
  // children?: ReactNode;
};

/** Timeframe a freshly opened pair starts on. */
const DEFAULT_TIMEFRAME_KEY = "1min";

type ChromeProps = {
  symbol: string;
  name?: string;
  decimals?: number;
  /**
   * The current bucket's open. Only changes when the series changes or rolls over, so this is
   * what lets the whole chrome sit still through a tick.
   */
  bucketOpen?: number;
  /**
   * The last candle's close, shown until the socket's first tick. Seeded once per series and
   * deliberately not kept current — see the note on `seedPrice`.
   */
  seedPrice: number | null;
  timeframeKey: string;
  onSelectTimeframe: (next: TimeframeOrLine) => void;
  onOpenInfo: () => void;
  periodLabel: string;
};

/**
 * Everything above the chart: the pair's name, its price, the timeframe tabs and the caption.
 *
 * Memoised because every one of its props is stable across a price tick. `CoinDetail` itself
 * still re-renders on each tick — the chart's series live in it — but before this existed that
 * re-render redrew all of this too. The price and the connection badge reach the screen through
 * the leaves inside it, which subscribe to the store themselves.
 */
const ChartChrome = memo(function ChartChrome({
  symbol,
  name,
  decimals,
  bucketOpen,
  seedPrice,
  timeframeKey,
  onSelectTimeframe,
  onOpenInfo,
  periodLabel,
}: ChromeProps) {
  const base = symbol.split("-")[0] ?? "";

  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.symbol}>{symbol || "—"}</Text>
          {name && name !== base ? (
            <Text style={styles.name}>{name}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={onOpenInfo}
          hitSlop={12}
          style={styles.infoButton}
          accessibilityRole="button"
          accessibilityLabel={`About ${symbol}`}
        >
          <InfoIcon size={17} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.priceBlock}>
        <LivePrice
          symbol={symbol}
          bucketOpen={bucketOpen}
          fallbackPrice={seedPrice ?? undefined}
          decimals={decimals}
        />
        <LiveBadge symbol={symbol} />
      </View>

      <View style={styles.timeframeRow}>
        <TimeframeTabs value={timeframeKey} onChange={onSelectTimeframe} />
      </View>

      <View style={styles.toolbar}>
        <Text style={styles.periodLabel} numberOfLines={1}>
          {periodLabel}
        </Text>
      </View>
    </>
  );
});

export function CoinDetail({ symbol, name, decimals }: Props) {
  const [timeframeKey, setTimeframeKey] = useState(DEFAULT_TIMEFRAME_KEY);
  const [infoOpen, setInfoOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);

  // A fixed standard height, not the leftover space. Measuring the chart from the leftover
  // gave it whatever the device had going, which on a tall phone left no room at all for the
  // ordering UI below. The hook holds that height steady while the order form's keyboard is
  // open, which on Android would otherwise shrink the window and collapse the chart.
  const chartHeight = useStableChartHeight();

  // This is one component instance shared by every pair the user opens, so opening a new
  // symbol has to put it back exactly as it looked on first open. Observed on device: a
  // symbol switch could leave the chart broken, while a timeframe switch — which changes
  // the same resetKey — always cleared it. Rather than depend on which internal state
  // happened to survive, this restores the defaults outright and the `key` on PriceChart
  // guarantees a real remount.
  //
  // chartHeight needs no reset: it is derived from the device, not chosen by the user.
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  if (symbol !== activeSymbol) {
    setActiveSymbol(symbol);
    setTimeframeKey(DEFAULT_TIMEFRAME_KEY);
    setVisibleCount(null);
    setInfoOpen(false);
  }

  const timeframe = useMemo(() => timeframeByKey(timeframeKey), [timeframeKey]);
  // The Line tab is a separate series, not a mode: it pages `endAt` backwards for the
  // whole history and renders as a line, which the candle timeframes no longer do.
  const isLine = timeframeKey === LINE_TIMEFRAME.key;
  const mode = isLine ? "line" : "candle";

  const live = useLiveCandles(symbol, timeframe, !isLine);
  const lifetime = useLifetimeSeries(symbol, isLine);

  const candles = isLine ? lifetime.candles : live.candles;
  const isLoading = isLine ? lifetime.isLoading : live.isLoading;
  const error = isLine ? lifetime.error : live.error;
  const refresh = isLine ? lifetime.refresh : live.refresh;

  // Only the currently forming candle is needed for the header, so nothing here walks the
  // array. A range summary used to be computed over all 100 candles on every tick.
  const current = candles.length > 0 ? candles[candles.length - 1]! : null;

  // Seeded lazily from the first candles of the series, once per series.
  // The header can show a price before the socket's first tick. Both series hooks seed one
  // from their own history, and both freeze it, so this value only moves when the series does.
  const seedPrice = isLine ? lifetime.seedPrice : live.seedPrice;
  const onSelectTimeframe = useCallback(
    (next: TimeframeOrLine) => setTimeframeKey(next.key),
    [],
  );
  const onOpenInfo = useCallback(() => setInfoOpen(true), []);
  const onCloseInfo = useCallback(() => setInfoOpen(false), []);
  const onVisibleRangeChange = useCallback(
    (visible: number) => setVisibleCount(visible),
    [],
  );
  const isZoomed = visibleCount !== null && visibleCount < candles.length;

  // "466 weeks · since 2017-10-19" reads as a lifetime at a glance. Absolute dates, not
  // "8 years ago", per the no-relative-date convention. Keyed on the two values it reads
  // rather than the array, so a forming candle does not recompute it every tick.
  const firstCandle = candles[0];
  const periodLabel = useMemo(() => {
    if (isLine) {
      if (!firstCandle) return "Line · loading history";
      const pad = (value: number) => value.toString().padStart(2, "0");
      const since = new Date(firstCandle.time);
      return `Line · ${candles.length} weeks · since ${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}`;
    }
    if (isZoomed) {
      return `${visibleCount} of ${candles.length} · pan, pinch, double tap to reset`;
    }
    return `${candles.length} × ${timeframe.label} · drag to pan, pinch to zoom`;
  }, [
    candles.length,
    firstCandle,
    isLine,
    isZoomed,
    timeframe.label,
    visibleCount,
  ]);

  return (
    <View style={styles.section}>
      <ChartChrome
        symbol={symbol}
        name={name}
        decimals={decimals}
        bucketOpen={current?.open}
        seedPrice={seedPrice}
        timeframeKey={timeframeKey}
        onSelectTimeframe={onSelectTimeframe}
        onOpenInfo={onOpenInfo}
        periodLabel={periodLabel}
      />

      <View style={styles.chartWrap}>
        {isLoading && candles.length === 0 ? (
          <View style={styles.loader}>
            <ActivityIndicator color={colors.accent} />
            {isLine && lifetime.pages > 0 ? (
              <Text style={styles.loaderCaption}>
                Loading full history · page {lifetime.pages}
              </Text>
            ) : null}
          </View>
        ) : error && candles.length === 0 ? (
          <Pressable style={styles.errorBox} onPress={refresh}>
            <Text style={styles.errorTitle}>
              {isLine ? "Could not load history" : "Could not load candles"}
            </Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorHint}>Tap to retry.</Text>
          </Pressable>
        ) : isLine && candles.length === 0 ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>No price history yet</Text>
            <Text style={styles.errorBody}>This pair is too new to chart.</Text>
          </View>
        ) : (
          <PriceChart
            // Remounts on a symbol change, which discards the pan offset, zoom level,
            // latched crosshair and cached price band outright. The chart's own resetKey
            // only handles a timeframe change; relying on it alone for the symbol left
            // enough state behind to render a broken chart.
            key={symbol}
            candles={candles}
            mode={mode}
            height={chartHeight}
            decimals={decimals}
            defaultSpan={isLine ? candles.length : undefined}
            resetKey={`${symbol}:${timeframe.key}`}
            onVisibleRangeChange={onVisibleRangeChange}
          />
        )}
      </View>

      {/* {children} */}

      <CoinInfoSheet
        symbol={symbol}
        visible={infoOpen}
        onClose={onCloseInfo}
        decimals={decimals}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    // Content-sized: this is one section of the screen's scroll view, not the screen itself.
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 1,
  },
  symbol: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  name: {
    color: colors.textFaint,
    fontSize: 11,
  },
  priceBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  timeframeRow: {
    flexGrow: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  periodLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  chartWrap: {
    justifyContent: "center",
  },
  loader: {
    alignSelf: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  loaderCaption: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  errorBox: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: spacing.xl,
  },
  errorHint: {
    color: colors.textFaint,
    fontSize: 12,
  },
  infoButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
    borderRadius: radius.pill,
  },
});
