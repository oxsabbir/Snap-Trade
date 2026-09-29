import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeTouchEvent,
} from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { Candle, ChartMode } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';
import { formatAmount, formatCompact, formatPercent, formatPrice } from '@/utils/format';

const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const AXIS_WIDTH = 54;
const GRID_LINES = 4;
const X_LABELS = 4;

/** Zooming in past this leaves too few candles to read, so it acts as the floor. */
const MIN_VISIBLE = 20;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;
/** Horizontal travel past this turns a touch into a pan instead of a crosshair tap. */
const PAN_SLOP = 6;

/**
 * Inset from the SVG edge so the first and last candles are not clipped in half.
 * See `plotInset` for how the value is derived.
 */
const PLOT_PAD = 6;
/**
 * Extra inset on the right only. The newest candle is the one users are reading and it
 * sits against the price axis, so it gets more clearance than the left edge.
 */
const RIGHT_EDGE_GAP = 10;
/** Candle body and volume bar widths as fractions of one slot. */
const CANDLE_BODY_RATIO = 0.62;
const VOLUME_BAR_RATIO = 0.7;
/** The pad is sized against the widest of the two, or bars still clip when zoomed in. */
const WIDEST_BAR_RATIO = Math.max(CANDLE_BODY_RATIO, VOLUME_BAR_RATIO);

/**
 * Inset that keeps the outermost bars clear of both SVG edges for `n` candles.
 *
 * The last candle's centre sits at `innerWidth - pad` and its bar half-width is
 * `(innerWidth - 2*pad) * R / (2n)`, so clearing the right edge means
 * `pad >= (innerWidth - 2*pad) * R / (2n)`. Solving for `pad` (the width depends on the
 * pad, so it cannot simply be added afterwards) gives `pad >= R*innerWidth / (2*(n+R))`.
 * `PLOT_PAD` is a floor so a normal chart keeps a little breathing room at the edges.
 */
function plotInset(innerWidth: number, n: number): number {
  const exact = (WIDEST_BAR_RATIO * innerWidth) / (2 * (n + WIDEST_BAR_RATIO));
  return Math.max(PLOT_PAD, exact);
}

/** Share of the plot band given to the volume sub-panel, and the gap above it. */
const VOLUME_RATIO = 0.24;
const VOLUME_GAP = 8;

type Props = {
  candles: Candle[];
  mode: ChartMode;
  height?: number;
  decimals?: number;
  /** Change this to force the viewport back to the full range, e.g. on timeframe switch. */
  resetKey?: string;
  onVisibleRangeChange?: (visible: number, total: number) => void;
};

/** The visible window after clamping against the loaded candle count. */
type ResolvedViewport = {
  span: number;
  offset: number;
  start: number;
};

type PinchBaseline = {
  distance: number;
  mid: number;
  span: number;
  offset: number;
};

type PanBaseline = {
  x0: number;
  span: number;
  offset: number;
  moved: boolean;
};

/** A quantised price band. `key` changes only when a refit is allowed to shrink it. */
type Domain = { key: string; lower: number; upper: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounds a raw axis step up to the nearest 1/2/5 x 10^n, so grid labels land on round
 * numbers instead of values like $60,123.45678.
 */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const mantissa = raw / magnitude;
  const factor = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return factor * magnitude;
}

/**
 * A band snapped outward to a round step. The step is always derived from the data
 * range, never from the width of an existing band: a width divided by GRID_LINES is
 * not a 1/2/5 number, so deriving it that way shifts the rounding lattice on every
 * pass and the axis never settles.
 *
 * A flat series would otherwise snap to a zero-height band and make the chart
 * disappear, so that case is widened by one step either side.
 */
function niceBand(min: number, max: number): { lower: number; upper: number } {
  const span = max > min ? max - min : Math.abs(max || 1) * 0.01;
  const gap = niceStep(span / GRID_LINES);
  const lower = Math.floor(min / gap) * gap;
  const upper = Math.ceil(max / gap) * gap;
  if (upper - lower <= 0) return { lower: lower - gap, upper: upper + gap };
  return { lower, upper };
}

function formatAxisTime(timestamp: number, spanMs: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (spanMs <= 86_400_000) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function touchDistance(a: NativeTouchEvent, b: NativeTouchEvent): number {
  return Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY);
}

function PriceChartComponent({
  candles,
  mode,
  height = 250,
  decimals,
  resetKey,
  onVisibleRangeChange,
}: Props) {
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [span, setSpan] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [domain, setDomain] = useState<Domain | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  // Reset during render when the caller signals a new series, matching the pattern
  // in useLiveCandles so a timeframe switch never renders the old window.
  const [activeKey, setActiveKey] = useState(resetKey);
  if (resetKey !== activeKey) {
    setActiveKey(resetKey);
    setSpan(null);
    setOffset(0);
    setActiveIndex(null);
    setDomain(null);
  }

  const count = candles.length;
  const innerWidth = Math.max(width - AXIS_WIDTH, 0);
  const innerHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 0);
  const volumeHeight = innerHeight * VOLUME_RATIO;
  const priceHeight = Math.max(innerHeight - VOLUME_GAP - volumeHeight, 0);
  const volumeTop = PAD_TOP + priceHeight + VOLUME_GAP;

  const { span: resolvedSpan, offset: resolvedOffset, start } = useMemo<ResolvedViewport>(() => {
    if (count === 0) return { span: 0, offset: 0, start: 0 };
    const resolved = clamp(span ?? count, Math.min(MIN_VISIBLE, count), count);
    const maxOffset = Math.max(count - resolved, 0);
    const resolvedOffsetIndex = clamp(offset, 0, maxOffset);
    return { span: resolved, offset: resolvedOffsetIndex, start: count - resolvedOffsetIndex - resolved };
  }, [count, offset, span]);

  /**
   * The plot area is inset from the SVG edges. Without this the first and last candles
   * are centred exactly on x=0 and x=innerWidth, so in candle mode half of each body is
   * clipped — the newest candle, the one that matters most, ends up sliced against the
   * price axis. Sized from the real span, since a symbol with only a handful of candles
   * has much wider bars than one zoomed to the 20-candle floor.
   *
   * The inset is deliberately asymmetric. `plotInset` returns the minimum that keeps bars
   * clear of the left edge; the right gets that plus `RIGHT_EDGE_GAP`, because that is the
   * edge the newest candle sits against and the one users read. The right side is therefore
   * always at least as safe as before, and the left side is unchanged.
   */
  const plotPadLeft = plotInset(innerWidth, Math.max(resolvedSpan, 1));
  const plotPadRight = plotPadLeft + RIGHT_EDGE_GAP;
  const plotWidth = Math.max(innerWidth - plotPadLeft - plotPadRight, 1);
  const plotLeft = plotPadLeft;

  // Reported upward so the toolbar can show the visible count. Deduped by value so
  // a drag never re-renders the parent on every frame.
  const reportedRef = useRef('');
  useEffect(() => {
    if (count === 0) return;
    const key = `${resolvedSpan}:${count}`;
    if (key === reportedRef.current) return;
    reportedRef.current = key;
    onVisibleRangeChange?.(resolvedSpan, count);
  }, [count, onVisibleRangeChange, resolvedSpan]);

  const window = useMemo(() => {
    if (count === 0 || innerWidth <= 0) return null;
    const slice = candles.slice(start, start + resolvedSpan);
    if (slice.length === 0) return null;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let volumeMax = 0;
    for (const candle of slice) {
      if (candle.low < min) min = candle.low;
      if (candle.high > max) max = candle.high;
      if (candle.volume > volumeMax) volumeMax = candle.volume;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

    return { candles: slice, min, max, volumeMax };
  }, [candles, count, innerWidth, resolvedSpan, start]);

  /**
   * Sticky price band. Ticks may only push it wider, so the chart does not rescale
   * itself under the user during a pump. A refit — new first candle from a bucket
   * rollover, or a new visible span from pinch/drag — is allowed to shrink it back.
   */
  if (window) {
    const key = `${window.candles[0]!.time}:${resolvedSpan}`;
    const current = domain && domain.key === key ? domain : null;

    if (!current) {
      const band = niceBand(window.min, window.max);
      setDomain({ key, ...band });
    } else if (window.min < current.lower || window.max > current.upper) {
      const band = niceBand(Math.min(window.min, current.lower), Math.max(window.max, current.upper));
      setDomain({ key, ...band });
    }
  }

  const scales = useMemo(() => {
    if (!window || !domain || innerWidth <= 0) return null;
    const range = domain.upper - domain.lower;
    if (!(range > 0)) return null;

    const n = window.candles.length;
    const x = (index: number) => (n === 1 ? plotLeft + plotWidth / 2 : plotLeft + (index / (n - 1)) * plotWidth);
    const y = (value: number) => PAD_TOP + (1 - (value - domain.lower) / range) * priceHeight;
    // Volume ceiling is quantised too, so the scale only moves on round numbers.
    const volumeCeiling = niceBand(0, window.volumeMax).upper;
    const vy = (value: number) => volumeTop + volumeHeight * (1 - value / volumeCeiling);

    return { x, y, vy, volumeCeiling, n };
  }, [domain, innerWidth, plotLeft, plotWidth, priceHeight, volumeHeight, volumeTop, window]);

  const pinchRef = useRef<PinchBaseline | null>(null);
  const panRef = useRef<PanBaseline | null>(null);
  const multiRef = useRef(false);
  const suppressCrosshairRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const resetViewport = useCallback(() => {
    setSpan(null);
    setOffset(0);
    setActiveIndex(null);
    setDomain(null);
  }, []);

  const indexAt = useCallback(
    (locationX: number) => {
      // Measured against the plot area, not the raw width, so a touch in the inset
      // padding still resolves to the first or last candle instead of overshooting.
      const ratio = clamp((locationX - plotLeft) / plotWidth, 0, 1);
      return start + Math.round(ratio * (resolvedSpan - 1));
    },
    [plotLeft, plotWidth, resolvedSpan, start]
  );

  const trackCrosshair = useCallback(
    (locationX: number) => {
      if (count === 0 || suppressCrosshairRef.current) return;
      setActiveIndex(indexAt(locationX));
    },
    [count, indexAt]
  );

  const handlePinch = useCallback(
    (touches: NativeTouchEvent[]) => {
      if (touches.length < 2 || count <= 0) return;
      const distance = touchDistance(touches[0]!, touches[1]!);
      const mid = (touches[0]!.locationX + touches[1]!.locationX) / 2;

      if (!pinchRef.current || distance <= 0) {
        pinchRef.current = {
          distance,
          mid,
          span: Math.max(resolvedSpan, 1),
          offset: resolvedOffset,
        };
        return;
      }

      const base = pinchRef.current;
      if (base.distance <= 0) return;

      // Spreading fingers zooms in, so a larger span divisor means fewer candles.
      const nextSpan = clamp(
        Math.round(base.span / (distance / base.distance)),
        Math.min(MIN_VISIBLE, count),
        count
      );
      const dx = mid - base.mid;
      const nextOffset = base.offset + (dx / plotWidth) * nextSpan;

      setSpan(nextSpan);
      setOffset(nextOffset);

      // Incremental baseline: each move measures from the last, so a long drag
      // cannot accumulate drift away from the fingers.
      pinchRef.current = { distance, mid, span: nextSpan, offset: nextOffset };
    },
    [count, plotWidth, resolvedOffset, resolvedSpan]
  );

  const onGrant = useCallback(
    (event: GestureResponderEvent) => {
      const { touches, locationX, locationY } = event.nativeEvent;
      if (touches.length >= 2) {
        multiRef.current = true;
        // A pinch is not a tap, so it must not leave a timestamp that a quick
        // follow-up tap could pair with and be misread as a double tap.
        lastTapRef.current = null;
        pinchRef.current = null;
        panRef.current = null;
        setActiveIndex(null);
        return;
      }

      const now = Date.now();
      const last = lastTapRef.current;
      const isDoubleTap =
        last !== null &&
        now - last.time < DOUBLE_TAP_MS &&
        Math.abs(locationX - last.x) < DOUBLE_TAP_SLOP &&
        Math.abs(locationY - last.y) < DOUBLE_TAP_SLOP;
      if (isDoubleTap) {
        lastTapRef.current = null;
        suppressCrosshairRef.current = true;
        resetViewport();
        return;
      }
      lastTapRef.current = { time: now, x: locationX, y: locationY };

      panRef.current = { x0: locationX, span: resolvedSpan, offset: resolvedOffset, moved: false };

      if (count === 0 || suppressCrosshairRef.current) return;
      // Tapping the candle the crosshair is already on dismisses it, which is the
      // only way back to a clean chart once a tap has latched it.
      const index = indexAt(locationX);
      setActiveIndex((previous) => (previous === index ? null : index));
    },
    [count, indexAt, resetViewport, resolvedOffset, resolvedSpan]
  );

  const onMove = useCallback(
    (event: GestureResponderEvent) => {
      const { touches, locationX } = event.nativeEvent;
      if (touches.length >= 2) {
        // Drop the crosshair the moment a second finger joins, so the pinch
        // gesture is not fighting an active inspection readout.
        if (!multiRef.current) setActiveIndex(null);
        multiRef.current = true;
        lastTapRef.current = null;
        handlePinch(touches);
        return;
      }
      // Lifting one finger mid-pinch should not suddenly start inspecting.
      if (multiRef.current) return;

      const pan = panRef.current;
      if (pan) {
        const dx = locationX - pan.x0;
        if (!pan.moved && Math.abs(dx) > PAN_SLOP) {
          pan.moved = true;
          // A drag is navigation, not inspection.
          setActiveIndex(null);
        }
        if (pan.moved) {
          // Dragging right pulls older candles into view, so offset grows.
          setOffset(pan.offset + (dx / plotWidth) * pan.span);
          return;
        }
      }

      trackCrosshair(locationX);
    },
    [handlePinch, plotWidth, trackCrosshair]
  );

  const onEnd = useCallback(() => {
    pinchRef.current = null;
    panRef.current = null;
    multiRef.current = false;
    suppressCrosshairRef.current = false;
    // The crosshair deliberately survives release: a tap latches it.
  }, []);

  // `PanResponder.create` is called during render, but every handler it receives is
  // only ever invoked later by the gesture system, at event time. Those handlers
  // read refs that hold gesture-local state (pinch baseline, pan baseline, tap
  // timing, whether a second finger is down) which has no render-time equivalent,
  // so the generic "no refs in render" rule does not apply here.
  /* eslint-disable react-hooks/refs */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: onGrant,
        onPanResponderMove: onMove,
        onPanResponderRelease: onEnd,
        onPanResponderTerminate: onEnd,
      }),
    [onEnd, onGrant, onMove]
  );
  /* eslint-enable react-hooks/refs */

  if (!window || !scales || width === 0) {
    return <View style={{ height }} onLayout={onLayout} />;
  }

  const { x, y, vy, volumeCeiling, n } = scales;
  const visible = window.candles;
  const first = visible[0]!;
  const last = visible[n - 1]!;
  const changePct = first.open === 0 ? 0 : ((last.close - first.open) / first.open) * 100;
  const tint = changePct >= 0 ? colors.up : colors.down;
  const localIndex = activeIndex === null ? -1 : activeIndex - start;
  const active = localIndex >= 0 && localIndex < n ? visible[localIndex]! : null;
  const spanMs = last.time - first.time;

  let linePath = '';
  let areaPath = '';
  if (mode === 'line') {
    const points = visible.map((candle, i) => `${x(i).toFixed(2)},${y(candle.close).toFixed(2)}`);
    linePath = `M${points.join('L')}`;
    areaPath = `${linePath}L${x(n - 1).toFixed(2)},${(PAD_TOP + priceHeight).toFixed(2)}L${x(0).toFixed(2)},${(PAD_TOP + priceHeight).toFixed(2)}Z`;
  }

  const bodyWidth = Math.max(1, (plotWidth / n) * CANDLE_BODY_RATIO);
  const barWidth = Math.max(1, (plotWidth / n) * VOLUME_BAR_RATIO);

  return (
    <View onLayout={onLayout} style={styles.container}>
      <View style={{ width: innerWidth, height }} {...panResponder.panHandlers}>
        <Svg width={innerWidth} height={height}>
          <Defs>
            <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={tint} stopOpacity={0.28} />
              <Stop offset="1" stopColor={tint} stopOpacity={0.01} />
            </LinearGradient>
          </Defs>

          {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
            const value = domain!.upper - ((domain!.upper - domain!.lower) / GRID_LINES) * i;
            const gy = y(value);
            return (
              <Line
                key={`grid-${i}`}
                x1={0}
                y1={gy}
                x2={innerWidth}
                y2={gy}
                stroke={colors.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            );
          })}

          {mode === 'line' ? (
            <>
              <Path d={areaPath} fill="url(#chartFill)" />
              <Path
                d={linePath}
                stroke={tint}
                strokeWidth={1.6}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </>
          ) : (
            visible.map((candle, i) => {
              const isUp = candle.close >= candle.open;
              const color = isUp ? colors.up : colors.down;
              const cx = x(i);
              const bodyTop = y(Math.max(candle.open, candle.close));
              const bodyBottom = y(Math.min(candle.open, candle.close));
              return (
                <Fragment key={candle.time}>
                  <Line x1={cx} y1={y(candle.high)} x2={cx} y2={y(candle.low)} stroke={color} strokeWidth={1} />
                  <Rect
                    x={cx - bodyWidth / 2}
                    y={bodyTop}
                    width={bodyWidth}
                    height={Math.max(bodyBottom - bodyTop, 1)}
                    fill={color}
                    fillOpacity={isUp ? 0.85 : 1}
                  />
                </Fragment>
              );
            })
          )}

          {/* Volume sub-panel, always shown regardless of line/candle mode. */}
          {visible.map((candle, i) => {
            const isUp = candle.close >= candle.open;
            const cx = x(i);
            const top = vy(candle.volume);
            return (
              <Rect
                key={`vol-${candle.time}`}
                x={cx - barWidth / 2}
                y={top}
                width={barWidth}
                height={Math.max(volumeTop + volumeHeight - top, 1)}
                fill={isUp ? colors.up : colors.down}
                fillOpacity={isUp ? 0.3 : 0.4}
              />
            );
          })}

          {Array.from({ length: X_LABELS }, (_, i) => {
            const index = Math.round((i / (X_LABELS - 1)) * (n - 1));
            const candle = visible[index];
            if (!candle) return null;
            const isFirst = i === 0;
            const isLast = i === X_LABELS - 1;
            // The edge labels are anchored inwards, so they sit directly under their
            // candle without needing a clamp. Only the middle ones need one, to keep a
            // long time string from running off the plot.
            const labelX = isFirst || isLast ? x(index) : Math.min(Math.max(x(index), 28), innerWidth - 28);
            return (
              <SvgText
                key={`x-${i}`}
                x={labelX}
                y={height - 4}
                fill={colors.textFaint}
                fontSize={10}
                textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
              >
                {formatAxisTime(candle.time, spanMs)}
              </SvgText>
            );
          })}

          {active ? (
            <>
              <Line
                x1={x(localIndex)}
                y1={PAD_TOP}
                x2={x(localIndex)}
                y2={volumeTop + volumeHeight}
                stroke={colors.textMuted}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {/* Price line stops at the price band so it does not cut the volume bars. */}
              <Line
                x1={0}
                y1={y(active.close)}
                x2={innerWidth}
                y2={y(active.close)}
                stroke={colors.textMuted}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            </>
          ) : null}
        </Svg>
      </View>

      <View style={{ width: AXIS_WIDTH, height }}>
        <View style={{ marginTop: PAD_TOP, height: priceHeight, justifyContent: 'space-between' }}>
          {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
            const value = domain!.upper - ((domain!.upper - domain!.lower) / GRID_LINES) * i;
            return (
              <Text key={`axis-${i}`} style={styles.axisLabel}>
                {formatPrice(value, decimals)}
              </Text>
            );
          })}
        </View>
        <View style={{ marginTop: VOLUME_GAP, height: volumeHeight, justifyContent: 'flex-start' }}>
          <Text style={styles.axisLabel}>{formatCompact(volumeCeiling)}</Text>
        </View>
      </View>

      {active ? (
        <View style={styles.readout} pointerEvents="none">
          <Text style={styles.readoutTime}>
            {new Date(active.time).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          <View style={styles.readoutGrid}>
            <OhlcCell label="O" value={formatPrice(active.open, decimals)} />
            <OhlcCell label="H" value={formatPrice(active.high, decimals)} />
            <OhlcCell label="L" value={formatPrice(active.low, decimals)} />
            <OhlcCell label="C" value={formatPrice(active.close, decimals)} />
          </View>
          <Text style={styles.readoutVolume}>
            Vol {formatAmount(active.volume)}
            {active.open !== 0
              ? `  ${formatPercent(((active.close - active.open) / active.open) * 100)}`
              : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function OhlcCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ohlcCell}>
      <Text style={styles.ohlcLabel}>{label}</Text>
      <Text style={styles.ohlcValue}>{value}</Text>
    </View>
  );
}

export const PriceChart = memo(PriceChartComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
  axisLabel: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'right',
  },
  readout: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    backgroundColor: 'rgba(23,24,26,0.94)',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    gap: 3,
  },
  readoutTime: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  readoutGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  ohlcCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ohlcLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
  },
  ohlcValue: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  readoutVolume: {
    color: colors.textMuted,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
