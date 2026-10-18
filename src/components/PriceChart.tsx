import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import {
  Canvas,
  Line,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  vec,
} from "@shopify/react-native-skia";

import type { Candle, ChartMode } from "@/lib/kucoin/types";
import { radius, spacing } from "@/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/themedStyles";
import { formatAmount, formatPercent, formatPrice } from "@/utils/format";

const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const AXIS_WIDTH = 54;
const TIME_LABEL_WIDTH = 44;
const BAND_STEPS = 4;
/** Target price-axis label count; the tick interval is chosen to land near this. */
const PRICE_LABELS = 8;
/** Fixed line box of an axis label, used to keep the end labels inside the plot. */
const AXIS_LABEL_HEIGHT = 12;
const X_LABELS = 4;
const MIN_VISIBLE = 20;
/**
 * Window width on first paint, in slots. A tenth of it is the right-hand pad (see `RIGHT_PAD`),
 * so this shows roughly thirty-six candles; the surplus of an `INITIAL_CANDLES` fetch waits off
 * the left edge, already rendered.
 */
const DEFAULT_SPAN = 40;
/**
 * How close the window's left edge must come to the oldest loaded candle before the next page is
 * requested, in candles. Zero means the oldest candle has to actually reach the edge: nothing is
 * fetched until the user has scrolled the loaded series all the way to its start.
 */
const PRELOAD_CANDLES = 0;
const CANDLE_BODY_RATIO = 0.72;
const HAIRLINE = StyleSheet.hairlineWidth;
/** Horizontal travel before a drag starts moving the window. */
const PAN_SLOP = 6;
/** Vertical escape, so the page's scroll view can win the gesture. */
const PAN_FAIL_Y: [number, number] = [-14, 14];
/**
 * A tap has no distance limit by default on Android, so a drag would still register as a
 * tap and drop a crosshair wherever the finger happened to lift. Anything past this is a
 * drag, not a tap.
 */
const TAP_SLOP = 12;
const TAP_DURATION = 400;
/** Window for the second tap. Shortened from the 500ms default so one tap feels immediate. */
const DOUBLE_TAP_DELAY = 260;
/**
 * How far past the edge the window may travel, as a fraction of the visible window. The window
 * hard-stops with the newest candle half a slot from the right edge; at 0.5 a full drag can
 * carry it to the middle of the plot, and no further.
 */
const OVERSCROLL = 0.5;
/** Fraction of a drag given up on the way out to that limit. */
const RESIST = 0.5;
/**
 * Empty plot left after the newest candle when the window is at rest, as a fraction of the
 * visible window. The window parks this far past the last candle so the series never ends flush
 * against the price axis.
 */
const RIGHT_PAD = 0.1;
/** Snaps the window back to its edge. Tight and slightly springy rather than bouncy. */
const SPRING = {
  damping: 19,
  stiffness: 190,
  mass: 0.8,
  overshootClamping: true,
};

type Props = {
  candles: Candle[];
  mode: ChartMode;
  height?: number;
  decimals?: number;
  defaultSpan?: number;
  resetKey?: string;
  onVisibleRangeChange?: (visible: number, total: number) => void;
  /** Asked for more older candles when the window reaches the left edge of the loaded series. */
  onLoadOlder?: () => void;
  /** Faint caption pinned to the grid's bottom-left corner, e.g. "40 × 1m". */
  caption?: string;
};
type Viewport = { start: number; span: number };
type Committed = Viewport & {
  key: string | undefined;
  count: number;
  /** Times of the oldest and newest candles when the window was committed. */
  oldestTime: number;
  newestTime: number;
};
type Domain = { lower: number; upper: number };

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(Math.max(value, min), max);
}
/**
 * Softens a drag that runs past either end of the window, then stops it.
 *
 * `cap` is how far past the edge the window may travel, in candles. Resistance is a plain
 * fraction rather than an asymptotic curve: an asymptotic one has to be approached to be felt,
 * so reaching its own limit needs several screens of finger travel and, short of that, there is
 * no real limit at all. A linear give-up reaches `cap` in one comfortable swipe and then holds,
 * which is what makes the newest candle stop at the middle of the plot instead of drifting.
 */
function resistedStart(raw: number, maxStart: number, cap: number): number {
  "worklet";
  const eased = (distance: number) =>
    Math.min(Math.max(distance, 0) * RESIST, cap);
  if (raw > maxStart) return maxStart + eased(raw - maxStart);
  if (raw < 0) return -eased(-raw);
  return raw;
}
function resolveSpan(count: number, span: number): number {
  "worklet";
  return count <= 0
    ? 0
    : clamp(Math.round(span), Math.min(MIN_VISIBLE, count), count);
}
/**
 * The window's rightmost resting position: past the newest candle by `RIGHT_PAD` of the visible
 * window, so there is always empty plot to the right of the series.
 */
function maxStartFor(count: number, span: number): number {
  "worklet";
  if (count <= 0) return 0;
  // The newest candle already rests half a slot in from the edge, so only the shortfall is added
  // on top. That makes RIGHT_PAD the fraction of the plot left empty after the last candle,
  // rather than the fraction of the window travelled past it.
  return Math.max(
    0,
    Math.round(Math.max(count - span, 0) + span * RIGHT_PAD - 0.5),
  );
}
function resolveStart(count: number, start: number, span: number): number {
  "worklet";
  return count <= 0 ? 0 : clamp(Math.round(start), 0, maxStartFor(count, span));
}
function defaultSpanFor(
  count: number,
  isLine: boolean,
  defaultSpan?: number,
): number {
  return resolveSpan(count, defaultSpan ?? (isLine ? count : DEFAULT_SPAN));
}

function niceStep(raw: number): number {
  "worklet";
  if (!(raw > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const mantissa = raw / magnitude;
  return (
    (mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10) * magnitude
  );
}
function niceBand(min: number, max: number): Domain {
  "worklet";
  const span = max > min ? max - min : Math.abs(max || 1) * 0.01;
  const gap = niceStep(span / BAND_STEPS);
  const lower = Math.floor(min / gap) * gap;
  const upper = Math.ceil(max / gap) * gap;
  return upper > lower
    ? { lower, upper }
    : { lower: lower - gap, upper: upper + gap };
}

interface PriceTick {
  value: number;
  fraction: number;
}
interface PriceAxis {
  step: number;
  ticks: PriceTick[];
}

/** Smallest step from the 1 / 2 / 2.5 / 5 x 10^n ladder whose tick count lands nearest the target. */
function priceStep(range: number, target: number): number {
  const rough = range / Math.max(target - 1, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  let best = magnitude;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const multiplier of [1, 2, 2.5, 5, 10]) {
    const step = multiplier * magnitude;
    const count = Math.floor(range / step + 1e-9) + 1;
    const score = Math.abs(count - target);
    if (score < bestScore || (score === bestScore && step > best)) {
      bestScore = score;
      best = step;
    }
  }
  return best;
}

/** Decimal places needed to write a step exactly, e.g. 2.5 -> 1, 1e-6 -> 6. */
function stepDecimals(step: number): number {
  if (!(step > 0)) return 0;
  let scaled = step;
  let places = 0;
  while (places < 12 && Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    scaled *= 10;
    places += 1;
  }
  return places;
}

/** Nice ticks across a band, as values plus their normalised vertical position. */
function priceAxis(lower: number, upper: number, target: number): PriceAxis {
  const range = upper - lower;
  if (!(range > 0) || !Number.isFinite(range)) return { step: 0, ticks: [] };
  const step = priceStep(range, target);
  if (!(step > 0)) return { step: 0, ticks: [] };
  const epsilon = step * 1e-6;
  const first = Math.ceil((lower - epsilon) / step);
  const last = Math.floor((upper + epsilon) / step);
  const ticks: PriceTick[] = [];
  for (let index = first; index <= last && ticks.length < 32; index += 1) {
    const value = Number((index * step).toPrecision(12));
    ticks.push({ value, fraction: (value - lower) / range });
  }
  return { step, ticks };
}

/** Drop trailing zeros from a fixed-decimal string so labels stay as short as possible. */
function trimZeros(label: string): string {
  return label.includes(".")
    ? label.replace(/0+$/, "").replace(/\.$/, "")
    : label;
}

/**
 * Price band for one window of the series, read from the packed array rather than from
 * `Candle` objects so the UI runtime and the JS thread derive it the same way.
 *
 * Every visible candle is read out of `packed`, including the newest. This function used to
 * substitute a separate four-number `forming` slot for the last index, which let the band end
 * up spanning two different coins at once: the window rendered flat, and dragging left — which
 * is the only thing that removes the last index from the window — made it look correct again.
 */
function visibleBand(
  packed: number[],
  count: number,
  start: number,
  span: number,
): Domain | null {
  "worklet";
  const to = Math.min(count, start + span);
  if (to <= start) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = start; index < to; index++) {
    const base = index * 4;
    const low = packed[base + 2];
    const high = packed[base + 1];
    if (low < min) min = low;
    if (high > max) max = high;
  }
  if (!isFinite(min) || !isFinite(max)) return null;
  return niceBand(min, max);
}

/** JS thread only: runs when the series itself changes, not on a forming-candle tick. */
function packCandles(candles: Candle[]): number[] {
  const packed = new Array<number>(candles.length * 4);
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index]!;
    packed[index * 4] = candle.open;
    packed[index * 4 + 1] = candle.high;
    packed[index * 4 + 2] = candle.low;
    packed[index * 4 + 3] = candle.close;
  }
  return packed;
}

function formatAxisTime(timestamp: number, spanMs: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (spanMs <= 86_400_000)
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (spanMs > 63_072_000_000) return date.getFullYear().toString();
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function PriceChartComponent({
  candles,
  mode,
  height = 200,
  decimals,
  defaultSpan,
  resetKey,
  onVisibleRangeChange,
  onLoadOlder,
  caption,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  // The viewport the user last settled on, tagged with the series and length it was
  // settled against so the render pass can tell a new candle from a new series.
  const [committed, setCommitted] = useState<Committed>({
    key: "",
    count: 0,
    start: 0,
    span: 0,
    oldestTime: 0,
    newestTime: 0,
  });
  const [selection, setSelection] = useState<{
    key: string | undefined;
    index: number;
  } | null>(null);

  const isLine = mode === "line";
  const count = candles.length;
  const firstTime = count > 0 ? candles[0]!.time : 0;
  const lastTime = count > 0 ? candles[count - 1]!.time : 0;
  const innerWidth = Math.max(width - AXIS_WIDTH, 0);
  const priceHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 1);
  const activeIndex =
    selection !== null && selection.key === resetKey ? selection.index : null;

  /**
   * Older candles were prepended below the committed window (the newest candle is unchanged but
   * the oldest moved back), so every index shifted by however many arrived. Shift the committed
   * viewport by the same amount in this render, otherwise the visible candles would jump right by
   * a whole page. Adjusting state during render is the supported way to react to a prop change
   * without an extra paint; it converges because the condition is false once applied.
   */
  if (
    committed.key === resetKey &&
    committed.newestTime !== 0 &&
    count > committed.count &&
    lastTime === committed.newestTime &&
    firstTime < committed.oldestTime
  ) {
    setCommitted({
      key: committed.key,
      count,
      start: committed.start + (count - committed.count),
      span: committed.span,
      oldestTime: firstTime,
      newestTime: committed.newestTime,
    });
  }

  // Everything the UI runtime needs. The series is flattened to open/high/low/close so the
  // worklet never touches objects. The newest candle is packed alongside the rest rather than
  // held in a separate slot: see `visibleBand`.
  const packed = useSharedValue<number[]>([]);
  const countValue = useSharedValue(0);
  const startValue = useSharedValue(0);
  const spanValue = useSharedValue(0);
  const plotWidth = useSharedValue(0);
  const plotHeight = useSharedValue(0);
  const lineValue = useSharedValue(isLine ? 1 : 0);
  /** Oldest/newest candle times, read by `commit` without depending on the candles array. */
  const oldestValue = useSharedValue(0);
  const newestValue = useSharedValue(0);
  /** 1 while a pan or pinch owns the window, so background re-renders leave `startValue` alone. */
  const gestureActive = useSharedValue(0);

  /**
   * The window to draw, derived during render rather than pushed into state by an effect.
   *
   * A forming-candle tick leaves the count alone, so this resolves to the committed viewport
   * and nothing downstream re-renders. Only a new series or new history moves it: a candle
   * forming at the right edge shifts the window by one, a Line page stays full width, and a
   * window the user had panned away from the right edge keeps its position.
   */
  const viewport = useMemo<Viewport>(() => {
    if (committed.key !== resetKey) {
      const span = defaultSpanFor(count, isLine, defaultSpan);
      return { start: maxStartFor(count, span), span };
    }
    if (committed.count === count)
      return { start: committed.start, span: committed.span };
    const previousSpan = committed.span;
    const atRightEdge =
      committed.start >= maxStartFor(committed.count, previousSpan) - 0.5;
    const span = resolveSpan(
      count,
      isLine && previousSpan >= committed.count ? count : previousSpan,
    );
    const start = atRightEdge
      ? maxStartFor(count, span)
      : resolveStart(count, committed.start, span);
    return { start, span };
  }, [committed, count, defaultSpan, isLine, resetKey]);

  const settledSpan = resolveSpan(count, viewport.span);
  const settledStart = resolveStart(count, viewport.start, settledSpan);

  useEffect(() => {
    lineValue.set(isLine ? 1 : 0);
  }, [isLine, lineValue]);
  useEffect(() => {
    plotWidth.set(innerWidth);
  }, [innerWidth, plotWidth]);
  useEffect(() => {
    plotHeight.set(priceHeight);
  }, [priceHeight, plotHeight]);
  /**
   * Mirrors the settled viewport into the shared window. Older history is prepended by shifting
   * `startValue` by the same number of candles rather than resetting it to the settled start:
   * resetting drops whatever offset an in-progress drag had (rubber-band past the edge, or a pan
   * that has not committed yet), which read as the chart snapping back the instant a page landed.
   * A change that is neither a prepend nor a new series is also skipped while a gesture owns the
   * window, so a background re-render cannot fight the finger; the commit reconciles it instead.
   */
  const priorSeries = useRef({
    key: resetKey as string | undefined,
    count,
    oldest: firstTime,
    newest: lastTime,
  });
  useEffect(() => {
    const prior = priorSeries.current;
    const newSeries = prior.key !== resetKey;
    priorSeries.current = {
      key: resetKey,
      count,
      oldest: firstTime,
      newest: lastTime,
    };
    spanValue.set(settledSpan);
    if (newSeries) {
      // A gesture never spans a series change; reset the counter in case one leaked.
      gestureActive.set(0);
      startValue.set(settledStart);
      return;
    }
    const prepended =
      prior.count > 0 &&
      count > prior.count &&
      lastTime === prior.newest &&
      firstTime < prior.oldest;
    if (prepended) {
      startValue.set(startValue.get() + (count - prior.count));
      return;
    }
    // Leave an in-flight gesture's window alone; it is already positioned by the finger and
    // will be reconciled when the gesture commits.
    if (gestureActive.get() > 0) return;
    startValue.set(settledStart);
  }, [
    count,
    firstTime,
    gestureActive,
    lastTime,
    resetKey,
    settledSpan,
    settledStart,
    spanValue,
    startValue,
  ]);

  /**
   * Re-pack whenever `candles` changes identity.
   *
   * This deliberately has no "is this really a new series?" guard. Every earlier version of
   * one compared the length and the oldest timestamp, and both are worthless here: candle
   * timestamps are bucket-aligned, so two coins produce identical ones, and a switch also
   * delivers the new series in two steps — `resetKey` moves first while `candles` still holds
   * the outgoing coin's data, then the real candles arrive. A guard either stamps the new
   * identity onto the old prices (rejecting the genuine data as unchanged) or fails to notice
   * the switch at all. Re-packing is a few thousand numbers a few times a second, which is
   * cheap next to the picture recording it feeds, and it cannot be wrong.
   */
  useEffect(() => {
    countValue.set(count);
    oldestValue.set(firstTime);
    newestValue.set(lastTime);
    if (count === 0) {
      packed.set([]);
      return;
    }
    packed.set(packCandles(candles));
  }, [candles, count, countValue, firstTime, lastTime, newestValue, oldestValue, packed]);

  useEffect(() => {
    if (count > 0) onVisibleRangeChange?.(settledSpan, count);
  }, [count, onVisibleRangeChange, settledSpan]);

  /**
   * Ask for older candles once the window has settled within `PRELOAD_CANDLES` of the oldest
   * loaded one. The trigger can be a pan (released near the edge) or a pinch (zoomed out past the
   * history already fetched); the hook de-dupes, so firing on every settle near the edge is free.
   * `settledStart < maxStart` skips the case where the window is parked at the right edge of a
   * series it already spans in full, which would otherwise page history in on mount.
   */
  useEffect(() => {
    if (count === 0 || settledStart > PRELOAD_CANDLES) return;
    if (settledStart >= maxStartFor(count, settledSpan)) return;
    onLoadOlder?.();
  }, [count, onLoadOlder, settledSpan, settledStart]);

  // The window only backs the axis labels and the crosshair, both of which are JS-thread
  // text. They settle on gesture end rather than tracking every frame.
  const visible = useMemo(
    () => candles.slice(settledStart, settledStart + settledSpan),
    [candles, settledSpan, settledStart],
  );
  const domain = useMemo(() => {
    if (visible.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const candle of visible) {
      min = Math.min(min, candle.low);
      max = Math.max(max, candle.high);
    }
    return niceBand(min, max);
  }, [visible]);
  const axis = useMemo(
    () => (domain ? priceAxis(domain.lower, domain.upper, PRICE_LABELS) : null),
    [domain],
  );
  const axisDecimals = axis ? stepDecimals(axis.step) : 0;

  // Mirrors the worklet's `xOf` exactly, so the crosshair sits on the candle it points at.
  const plotX = useCallback(
    (index: number) =>
      settledSpan <= 1
        ? innerWidth / 2
        : (index - settledStart + 0.5) * (innerWidth / settledSpan),
    [innerWidth, settledSpan, settledStart],
  );
  const plotY = useCallback(
    (value: number) => {
      if (!domain) return 0;
      return (
        PAD_TOP +
        (1 - (value - domain.lower) / (domain.upper - domain.lower)) *
          priceHeight
      );
    },
    [domain, priceHeight],
  );

  // Static plot grid: depends on layout and the settled window only, never on live candle values.
  const gridPicture = useMemo(() => {
    const canvasHeight = priceHeight + PAD_TOP + PAD_BOTTOM;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(
      Skia.XYWHRect(0, 0, innerWidth, canvasHeight),
    );
    const grid = Skia.Paint();
    const border = Skia.Paint();
    grid.setStyle(PaintStyle.Stroke);
    grid.setStrokeWidth(HAIRLINE);
    grid.setColor(Skia.Color(colors.gridLine));
    border.setStyle(PaintStyle.Stroke);
    border.setStrokeWidth(HAIRLINE);
    border.setColor(Skia.Color(colors.gridBorder));

    for (const tick of axis?.ticks ?? []) {
      const y = PAD_TOP + (1 - tick.fraction) * priceHeight;
      canvas.drawLine(0, y, innerWidth, y, grid);
    }

    const visibleCount = Math.max(
      0,
      Math.min(count, settledStart + settledSpan) - settledStart,
    );
    if (visibleCount > 0) {
      const step = settledSpan <= 1 ? innerWidth : innerWidth / settledSpan;
      for (let index = 0; index < X_LABELS; index++) {
        const at = Math.round((index / (X_LABELS - 1)) * (visibleCount - 1));
        const candleX = settledSpan <= 1 ? innerWidth / 2 : (at + 0.5) * step;
        const labelLeft = Math.max(candleX - TIME_LABEL_WIDTH / 2, 0);
        const x = labelLeft + TIME_LABEL_WIDTH / 2;
        canvas.drawLine(x, PAD_TOP, x, PAD_TOP + priceHeight, grid);
      }
    }

    const inset = HAIRLINE / 2;
    canvas.drawRect(
      Skia.XYWHRect(
        inset,
        PAD_TOP + inset,
        Math.max(innerWidth - HAIRLINE, 0),
        Math.max(priceHeight - HAIRLINE, 0),
      ),
      border,
    );
    grid.dispose();
    border.dispose();
    const picture = recorder.finishRecordingAsPicture();
    recorder.dispose();
    return picture;
  }, [
    axis,
    colors.gridBorder,
    colors.gridLine,
    count,
    innerWidth,
    priceHeight,
    settledSpan,
    settledStart,
  ]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );

  const commit = useCallback(() => {
    setCommitted({
      key: resetKey,
      count: countValue.get(),
      start: Math.round(startValue.get()),
      span: spanValue.get(),
      oldestTime: oldestValue.get(),
      newestTime: newestValue.get(),
    });
  }, [countValue, newestValue, oldestValue, resetKey, spanValue, startValue]);

  const resetViewport = useCallback(() => {
    const span = defaultSpanFor(count, isLine, defaultSpan);
    const start = maxStartFor(count, span);
    spanValue.set(span);
    startValue.set(start);
    setCommitted({
      key: resetKey,
      count,
      start,
      span,
      oldestTime: firstTime,
      newestTime: lastTime,
    });
    setSelection(null);
  }, [
    count,
    defaultSpan,
    firstTime,
    isLine,
    lastTime,
    resetKey,
    spanValue,
    startValue,
  ]);

  const selectAt = useCallback(
    (x: number) => {
      if (count === 0 || settledSpan === 0) return;
      const index = Math.min(
        settledStart +
          Math.round(
            clamp(x / Math.max(innerWidth, 1), 0, 1) * (settledSpan - 1),
          ),
        count - 1,
      );
      setSelection((previous) =>
        previous !== null &&
        previous.key === resetKey &&
        previous.index === index
          ? null
          : { key: resetKey, index },
      );
    },
    [count, innerWidth, resetKey, settledSpan, settledStart],
  );

  const clearActive = useCallback(() => setSelection(null), []);

  /**
   * The whole plot, drawn on Reanimated's UI runtime and handed to Skia as one recorded
   * picture. Pan, pinch and every forming-candle tick rebuild it from the shared window, so
   * the canvas never unmounts, the reconciler never re-runs, and the price band is derived
   * from the same viewport as the geometry — which is what previously let a zoomed view
   * scale its candles out of their own domain.
   */
  const chartPicture = useDerivedValue(() => {
    const widthValue = plotWidth.get();
    const heightValue = plotHeight.get();
    const recorder = Skia.PictureRecorder();

    if (widthValue <= 0 || heightValue <= 0) {
      recorder.beginRecording(Skia.XYWHRect(0, 0, 0, 0));
      const blank = recorder.finishRecordingAsPicture();
      recorder.dispose();
      return blank;
    }

    const canvas = recorder.beginRecording(
      Skia.XYWHRect(0, 0, widthValue, heightValue),
    );
    const total = countValue.get();
    const series = packed.get();
    const span = resolveSpan(total, spanValue.get()) || 1;
    // A rubber-banded drag parks `startValue` outside the window, so the indices read out of the
    // series stay clamped while the offset that positions them is left alone — that offset is
    // the whole point, it is what moves the candles and exposes the empty edge.
    const offset = startValue.get();
    const start = clamp(Math.round(offset), 0, maxStartFor(total, span));
    const band = visibleBand(series, total, start, span);

    if (!band) {
      const blank = recorder.finishRecordingAsPicture();
      recorder.dispose();
      return blank;
    }

    // Skia copies paints and paths into the recorded display list, so these can be released
    // as soon as recording finishes.
    const scratch: { dispose(): void }[] = [];
    const range = band.upper - band.lower;
    // One slot per candle, with each candle centred in its slot. Spacing the first and last
    // candles exactly on the edges instead pinned them to x=0 and x=width, so the bodies of the
    // leftmost and rightmost candles were sliced in half by the canvas edge.
    const step = span <= 1 ? widthValue : widthValue / span;
    const xOf = (index: number) =>
      span <= 1 ? widthValue / 2 : (index - offset + 0.5) * step;
    const yOf = (value: number) =>
      PAD_TOP + (1 - (value - band.lower) / range) * heightValue;
    const to = Math.min(total, start + span);
    const closeOf = (index: number) => series[index * 4 + 3];

    if (lineValue.get() === 1) {
      const firstOpen = series[start * 4];
      const lastClose = closeOf(to - 1);
      const tint = lastClose >= firstOpen ? colors.up : colors.down;

      const linePath = Skia.Path.Make();
      const areaPath = Skia.Path.Make();
      scratch.push(linePath, areaPath);
      for (let index = start; index < to; index++) {
        const x = xOf(index);
        const y = yOf(closeOf(index));
        if (index === start) {
          linePath.moveTo(x, y);
          areaPath.moveTo(x, y);
        } else {
          linePath.lineTo(x, y);
          areaPath.lineTo(x, y);
        }
      }
      if (to - start > 1) {
        areaPath.lineTo(xOf(to - 1), PAD_TOP + heightValue);
        areaPath.lineTo(xOf(start), PAD_TOP + heightValue);
        areaPath.close();
      }

      const fill = Skia.Paint();
      const stroke = Skia.Paint();
      scratch.push(fill, stroke);
      fill.setShader(
        Skia.Shader.MakeLinearGradient(
          Skia.Point(0, PAD_TOP),
          Skia.Point(0, PAD_TOP + heightValue),
          [Skia.Color(tint), Skia.Color(`${tint}00`)],
          null,
          TileMode.Clamp,
        ),
      );
      canvas.drawPath(areaPath, fill);
      stroke.setStyle(PaintStyle.Stroke);
      stroke.setStrokeWidth(1.6);
      stroke.setStrokeJoin(StrokeJoin.Round);
      stroke.setStrokeCap(StrokeCap.Round);
      stroke.setColor(Skia.Color(tint));
      if (to - start > 1) canvas.drawPath(linePath, stroke);
      // A one-candle series has no segment to stroke, so the close is marked directly.
      else {
        stroke.setStyle(PaintStyle.Fill);
        canvas.drawCircle(xOf(start), yOf(closeOf(start)), 3, stroke);
      }
    } else {
      const bodyUp = Skia.Paint();
      const bodyDown = Skia.Paint();
      const wick = Skia.Paint();
      scratch.push(bodyUp, bodyDown, wick);
      const up = Skia.Color(colors.up);
      const down = Skia.Color(colors.down);
      bodyUp.setColor(up);
      bodyDown.setColor(down);
      bodyUp.setAlphaf(1);
      bodyDown.setAlphaf(1);
      wick.setStyle(PaintStyle.Stroke);
      wick.setStrokeWidth(1);

      const bodyWidth = Math.max(1, step * CANDLE_BODY_RATIO);
      for (let index = start; index < to; index++) {
        const base = index * 4;
        const high = series[base + 1];
        const low = series[base + 2];
        const x = xOf(index);
        wick.setColor(series[base + 3] >= series[base] ? up : down);
        canvas.drawLine(x, yOf(high), x, yOf(low), wick);
      }

      for (let index = start; index < to; index++) {
        const base = index * 4;
        const open = series[base];
        const close = series[base + 3];
        const rising = close >= open;
        const x = xOf(index);
        const top = Math.min(yOf(open), yOf(close));
        const bottom = Math.max(yOf(open), yOf(close));
        canvas.drawRect(
          Skia.XYWHRect(
            x - bodyWidth / 2,
            top,
            bodyWidth,
            Math.max(bottom - top, 1),
          ),
          rising ? bodyUp : bodyDown,
        );
      }
    }

    const picture = recorder.finishRecordingAsPicture();
    recorder.dispose();
    for (let index = 0; index < scratch.length; index++)
      scratch[index]!.dispose();
    return picture;
  }, [
    colors.down,
    colors.up,
    countValue,
    lineValue,
    packed,
    plotHeight,
    plotWidth,
    spanValue,
    startValue,
  ]);

  const panLast = useSharedValue(0);
  // Set while a drag sits at the left edge and a page has been asked for; cleared once the window
  // moves away, so a continued drag pages again only after the previous page has landed.
  const panLoadArmed = useSharedValue(0);
  const pinchSpan = useSharedValue(0);
  const pinchStart = useSharedValue(0);
  const pinchFocal = useSharedValue(0.5);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-PAN_SLOP, PAN_SLOP])
        .failOffsetY(PAN_FAIL_Y)
        .onBegin(() => {
          panLast.set(0);
          gestureActive.set(gestureActive.get() + 1);
        })
        // Cleared on activation rather than on touch-down: a tap that never becomes a drag used
        // to clear the crosshair first and immediately re-select it, which made tapping the same
        // candle again unable to dismiss it.
        .onStart(() => {
          runOnJS(clearActive)();
        })
        .onUpdate((event) => {
          const count = countValue.get();
          const span = spanValue.get();
          const perPixel = span / Math.max(plotWidth.get(), 1);
          const maxStart = maxStartFor(count, span);
          // Applied as a delta from the previous frame rather than from the gesture's start, so a
          // page of older candles arriving mid-drag (which shifts `startValue` to keep the visible
          // candles still) is not undone by the next update.
          const dx = event.translationX - panLast.get();
          panLast.set(event.translationX);
          // Resistance only past the edge, so the window still tracks the finger one-to-one for the
          // whole of its travel and the stop is felt as a soft wall rather than a dead end.
          const raw = startValue.get() - dx * perPixel;
          startValue.set(resistedStart(raw, maxStart, span * OVERSCROLL));
          // Reaching the oldest loaded candle (within PRELOAD_CANDLES of it) asks for the next
          // page; once older candles land the window is pushed back into the series, so this
          // re-arms and the drag keeps going. `raw < maxStart` keeps a window that already spans
          // the whole series from paging in history the user never scrolled towards.
          if (raw <= PRELOAD_CANDLES && raw < maxStart) {
            if (onLoadOlder && panLoadArmed.get() === 0) {
              panLoadArmed.set(1);
              runOnJS(onLoadOlder)();
            }
          } else if (raw > Math.max(PRELOAD_CANDLES, span * 0.5)) {
            panLoadArmed.set(0);
          }
        })
        .onFinalize(() => {
          gestureActive.set(Math.max(0, gestureActive.get() - 1));
          const span = spanValue.get();
          const maxStart = maxStartFor(countValue.get(), span);
          const current = startValue.get();
          const target = clamp(Math.round(current), 0, maxStart);
          if (target === current) {
            runOnJS(commit)();
            return;
          }
          // Settle first, then latch. Committing up front would rewrite the committed window, whose
          // effect pushes `startValue` back and cancel the animation mid-flight.
          startValue.set(
            withSpring(target, SPRING, (finished) => {
              "worklet";
              if (finished) runOnJS(commit)();
            }),
          );
        }),
    [
      clearActive,
      commit,
      countValue,
      gestureActive,
      onLoadOlder,
      panLast,
      panLoadArmed,
      plotWidth,
      spanValue,
      startValue,
    ],
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin((event) => {
          gestureActive.set(gestureActive.get() + 1);
          pinchSpan.set(spanValue.get());
          pinchStart.set(startValue.get());
          pinchFocal.set(
            clamp(event.focalX / Math.max(plotWidth.get(), 1), 0, 1),
          );
        })
        .onStart(() => {
          runOnJS(clearActive)();
        })
        .onUpdate((event) => {
          const span = resolveSpan(
            countValue.get(),
            pinchSpan.get() / Math.max(event.scale, 0.01),
          );
          const focal = pinchFocal.get();
          const anchor = pinchStart.get() + focal * (pinchSpan.get() - 1);
          startValue.set(
            clamp(
              anchor - focal * (span - 1),
              0,
              maxStartFor(countValue.get(), span),
            ),
          );
          spanValue.set(span);
        })
        .onFinalize(() => {
          gestureActive.set(Math.max(0, gestureActive.get() - 1));
          runOnJS(commit)();
        }),
    [
      clearActive,
      commit,
      countValue,
      gestureActive,
      pinchFocal,
      pinchSpan,
      pinchStart,
      plotWidth,
      spanValue,
      startValue,
    ],
  );

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(TAP_SLOP)
        .maxDuration(TAP_DURATION)
        .onEnd((event, success) => {
          if (success) runOnJS(selectAt)(event.x);
        }),
    [selectAt],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDistance(TAP_SLOP)
        .maxDuration(TAP_DURATION)
        .maxDelay(DOUBLE_TAP_DELAY)
        .onEnd((_event, success) => {
          if (success) runOnJS(resetViewport)();
        }),
    [resetViewport],
  );

  // Drags sit outside the taps rather than beside them. Under Simultaneous an activating pan
  // left the tap alive, so a drag that stayed inside the tap slop still landed a crosshair.
  const gestures = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Simultaneous(pan, pinch),
        Gesture.Exclusive(doubleTap, singleTap),
      ),
    [doubleTap, pan, pinch, singleTap],
  );

  if (width === 0) return <View style={{ height }} onLayout={onLayout} />;

  const active = activeIndex === null ? null : (candles[activeIndex] ?? null);
  const activeX = activeIndex === null || !active ? 0 : plotX(activeIndex);
  const activeY = active ? plotY(active.close) : 0;
  const spanMs =
    visible.length > 1
      ? visible[visible.length - 1]!.time - visible[0]!.time
      : 0;

  return (
    <View style={styles.container} onLayout={onLayout}>
      <GestureDetector gesture={gestures}>
        <View style={{ width: innerWidth, height }}>
          <Canvas style={styles.canvas}>
            <Picture picture={gridPicture} />
            <Picture picture={chartPicture} />
            {active ? (
              <>
                <Line
                  p1={vec(activeX, PAD_TOP)}
                  p2={vec(activeX, PAD_TOP + priceHeight)}
                  color={colors.textMuted}
                  strokeWidth={1}
                />
                <Line
                  p1={vec(0, activeY)}
                  p2={vec(innerWidth, activeY)}
                  color={colors.textMuted}
                  strokeWidth={1}
                />
              </>
            ) : null}
          </Canvas>
        </View>
      </GestureDetector>
      <View style={{ width: AXIS_WIDTH, height }}>
        {axis?.ticks.map((tick) => {
          const top = clamp(
            PAD_TOP + (1 - tick.fraction) * priceHeight - AXIS_LABEL_HEIGHT / 2,
            0,
            Math.max(height - AXIS_LABEL_HEIGHT, 0),
          );
          return (
            <Text
              key={`axis-${tick.value}`}
              numberOfLines={1}
              style={[
                styles.axisLabel,
                {
                  position: "absolute",
                  right: 0,
                  top,
                  width: AXIS_WIDTH,
                  height: AXIS_LABEL_HEIGHT,
                  lineHeight: AXIS_LABEL_HEIGHT,
                },
              ]}
            >
              {trimZeros(formatPrice(tick.value, axisDecimals))}
            </Text>
          );
        })}
      </View>
      {Array.from({ length: X_LABELS }, (_, index) => {
        const at = Math.round((index / (X_LABELS - 1)) * (visible.length - 1));
        const candle = visible[at];
        if (!candle) return null;
        // Anchored to the candle itself rather than to an even split of the width, which put the
        // labels up to a full half-slot away from the candles they name.
        const left = Math.max(
          plotX(settledStart + at) - TIME_LABEL_WIDTH / 2,
          0,
        );
        return (
          <Text key={`time-${index}`} style={[styles.timeLabel, { left }]}>
            {formatAxisTime(candle.time, spanMs)}
          </Text>
        );
      })}
      {caption ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
      {active ? <Readout candle={active} decimals={decimals} /> : null}
    </View>
  );
}

function Readout({ candle, decimals }: { candle: Candle; decimals?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.readout} pointerEvents="none">
      <Text style={styles.readoutTime}>
        {new Date(candle.time).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>
      <View style={styles.readoutGrid}>
        <OhlcCell label="O" value={formatPrice(candle.open, decimals)} />
        <OhlcCell label="H" value={formatPrice(candle.high, decimals)} />
        <OhlcCell label="L" value={formatPrice(candle.low, decimals)} />
        <OhlcCell label="C" value={formatPrice(candle.close, decimals)} />
      </View>
      <Text style={styles.readoutVolume}>
        Vol {formatAmount(candle.volume)}
        {candle.open !== 0
          ? `  ${formatPercent(((candle.close - candle.open) / candle.open) * 100)}`
          : ""}
      </Text>
    </View>
  );
}
function OhlcCell({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.ohlcCell}>
      <Text style={styles.ohlcLabel}>{label}</Text>
      <Text style={styles.ohlcValue}>{value}</Text>
    </View>
  );
}

export const PriceChart = memo(PriceChartComponent);

const useStyles = createThemedStyles((colors) =>
  StyleSheet.create({
    container: { flexDirection: "row", position: "relative", paddingTop: 5 },
    canvas: { flex: 1 },
    axisLabel: {
      color: colors.textFaint,
      fontSize: 10,
      textAlign: "left",
      paddingHorizontal: 10,
    },
    timeLabel: {
      position: "absolute",
      bottom: 2,
      color: colors.textFaint,
      fontSize: 10,
      width: TIME_LABEL_WIDTH,
      textAlign: "center",
    },
    // Pinned inside the grid, just above the time-label strip, so it never collides with it.
    caption: {
      position: "absolute",
      left: 5,
      bottom: PAD_BOTTOM + 5,
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.4,
      opacity: 0.6,
    },
    readout: {
      position: "absolute",
      top: spacing.xs,
      left: spacing.xs,
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      gap: 3,
    },
    readoutTime: { color: colors.textMuted, fontSize: 10, fontWeight: "600" },
    readoutGrid: { flexDirection: "row", gap: spacing.md },
    ohlcCell: { flexDirection: "row", alignItems: "center", gap: 3 },
    ohlcLabel: { color: colors.textFaint, fontSize: 10, fontWeight: "700" },
    ohlcValue: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    readoutVolume: {
      color: colors.textMuted,
      fontSize: 10,
      fontVariant: ["tabular-nums"],
    },
  }),
);
