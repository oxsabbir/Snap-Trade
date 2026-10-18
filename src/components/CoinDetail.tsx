import {
  memo,
  useCallback,
  useMemo,
  useState } from "react";
import { Pressable, View } from '@/components/AppLayout';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';

import { CoinInfoSheet } from "@/components/CoinInfoSheet";
import { BackIcon, InfoIcon } from "@/components/Icons";
import { LiveBadge } from "@/components/LiveBadge";
import { LivePrice } from "@/components/LivePrice";
import { PositionPnlChip } from "@/components/PositionPnlChip";
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
import { radius, spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";

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
  /** Shown as a back affordance in the title row when this screen is a pushed route. */
  onBack?: () => void;
  /**
   * Signal readout carried by a signal deep link, shown centred in the title row. TP posts (first
   * influencer) carry `signalTp1`; gem posts (second influencer) carry `signalEntry`. The two are
   * mutually exclusive, so only one is ever shown. Null on the tab.
   */
  signalTp1?: string | null;
  signalEntry?: string | null;
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
  /**
   * Rendered as an icon just before the info button. Only supplied when this screen is a pushed
   * route (a signal deep link); the tab has nothing to go back to.
   */
  onBack?: () => void;
  /**
   * Signal readout, centred in the title row. A TP post (first influencer) supplies `signalTp1`
   * and nothing else; a gem post (second influencer) supplies `signalEntry` (its posted market
   * price). Mutually exclusive, so the row shows "TP1: …" or "CMP: …", never both.
   */
  signalTp1?: string | null;
  signalEntry?: string | null;
};

/**
 * The signal's target, centred in the title row: "TP1: 0.0034" for a TP post or "CMP: 0.0007320"
 * for a gem post. One line, one value — the two formats never arrive together.
 */
function SignalReadout({ tp1, entry }: { tp1?: string | null; entry?: string | null }) {
  const styles = useStyles();
  const value = tp1 ?? entry;
  if (!value) return null;

  return (
    <View style={styles.signalCenter} pointerEvents="none">
      <Text style={styles.signalStat} numberOfLines={1}>
        <Text style={styles.signalStatLabel}>{tp1 ? "TP1: " : "CMP: "}</Text>
        {value}
      </Text>
    </View>
  );
}

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
  onBack,
  signalTp1,
  signalEntry,
}: ChromeProps) {
  const { colors } = useTheme();
  const styles = useStyles();
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
        {/* Centred across the row, before the back affordance: the posted signal value. */}
        <SignalReadout tp1={signalTp1} entry={signalEntry} />
        <View style={styles.headerActions}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={12}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <BackIcon size={17} color={colors.textMuted} />
            </Pressable>
          ) : null}
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
      </View>

      <View style={styles.priceBlock}>
        <LivePrice
          symbol={symbol}
          bucketOpen={bucketOpen}
          fallbackPrice={seedPrice ?? undefined}
          decimals={decimals}
        />
        <PositionPnlChip
          symbol={symbol}
          fallbackPrice={seedPrice ?? undefined}
        />
        <LiveBadge symbol={symbol} />
      </View>

      <View style={styles.timeframeRow}>
        <TimeframeTabs value={timeframeKey} onChange={onSelectTimeframe} />
      </View>
    </>
  );
});

export function CoinDetail({ symbol, name, decimals, signalTp1, signalEntry, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
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

  // Corner caption: the window and how much history is loaded. "40-160 × 1m" reads as forty
  // one-minute candles on screen out of the hundred and sixty loaded; the second number grows as
  // older pages arrive. Keyed on the values it reads rather than the array, so a forming candle
  // does not recompute it every tick.
  const firstCandle = candles[0];
  const candleLabel = useMemo(() => {
    if (isLine) {
      if (!firstCandle) return "Loading history";
      const pad = (value: number) => value.toString().padStart(2, "0");
      const since = new Date(firstCandle.time);
      return `${candles.length} weeks · since ${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}`;
    }
    return `${visibleCount ?? candles.length}-${candles.length} × ${timeframe.label}`;
  }, [candles.length, firstCandle, isLine, timeframe.label, visibleCount]);

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
        onBack={onBack}
        signalTp1={signalTp1}
        signalEntry={signalEntry}
      />

      <View style={styles.chartWrap}>
        {/*
          Rendered unconditionally, and deliberately not keyed on the symbol. Replacing it
          with a spinner while a pair loaded tore down the canvas, the Skia surface, every
          shared value and the mapper that feeds them, then rebuilt all of it — and the
          rebuilt chart drew a half-initialised picture on every coin after the first. The
          chart already draws nothing for an empty series, so the loading and error states
          go over the top instead of taking its place. `resetKey` alone resets the window,
          because `PriceChart` re-derives its viewport whenever that key changes.
        */}
        <PriceChart
          candles={candles}
          mode={mode}
          height={chartHeight}
          decimals={decimals}
          resetKey={`${symbol}:${timeframe.key}`}
          onVisibleRangeChange={onVisibleRangeChange}
          onLoadOlder={isLine ? undefined : live.loadOlder}
          caption={candles.length > 0 ? candleLabel : undefined}
        />

        {candles.length === 0 ? (
          <View style={styles.chartOverlay}>
            {isLoading ? (
              <View style={styles.loader}>
                <ActivityIndicator color={colors.accent} />
                {isLine && lifetime.pages > 0 ? (
                  <Text style={styles.loaderCaption}>
                    Loading full history · page {lifetime.pages}
                  </Text>
                ) : null}
              </View>
            ) : error ? (
              <Pressable style={styles.errorBox} onPress={refresh}>
                <Text style={styles.errorTitle}>
                  {isLine ? "Could not load history" : "Could not load candles"}
                </Text>
                <Text style={styles.errorBody}>{error}</Text>
                <Text style={styles.errorHint}>Tap to retry.</Text>
              </Pressable>
            ) : isLine ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>No price history yet</Text>
                <Text style={styles.errorBody}>
                  This pair is too new to chart.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
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

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
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
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
    },
    // Overlays the title row so the readout is centred across the full width regardless of how
    // wide the pair name is; it ignores touches, so the back and info buttons stay tappable.
    signalCenter: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    signalStat: {
      color: colors.up,
      fontSize: 13,
      fontWeight: "800",
      fontVariant: ["tabular-nums"],
    },
    signalStatLabel: {
      color: colors.up,
      fontWeight: "700",
      opacity: 0.72,
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
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    timeframeRow: {
      flexGrow: 0,
    },
    chartWrap: {
      justifyContent: "center",
    },
    // Sits over the chart, which stays mounted underneath it.
    chartOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bg,
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
    iconButton: {
      padding: spacing.xs,
      borderRadius: radius.pill,
    },
  }),
);
