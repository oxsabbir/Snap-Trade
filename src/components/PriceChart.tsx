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
import { colors, spacing } from '@/theme';
import { formatPrice } from '@/utils/format';

const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const AXIS_WIDTH = 54;
const GRID_LINES = 4;
const X_LABELS = 4;

/** Zooming in past this leaves too few candles to read, so it acts as the floor. */
const MIN_VISIBLE = 20;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  height = 240,
  decimals,
  resetKey,
  onVisibleRangeChange,
}: Props) {
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [span, setSpan] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

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
  }

  const count = candles.length;
  const innerWidth = Math.max(width - AXIS_WIDTH, 0);
  const innerHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 0);

  const { span: resolvedSpan, offset: resolvedOffset, start } = useMemo<ResolvedViewport>(() => {
    if (count === 0) return { span: 0, offset: 0, start: 0 };
    const resolved = clamp(span ?? count, Math.min(MIN_VISIBLE, count), count);
    const maxOffset = Math.max(count - resolved, 0);
    const resolvedOffsetIndex = clamp(offset, 0, maxOffset);
    return { span: resolved, offset: resolvedOffsetIndex, start: count - resolvedOffsetIndex - resolved };
  }, [count, offset, span]);

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

  const geometry = useMemo(() => {
    if (count === 0 || innerWidth <= 0) return null;

    const window = candles.slice(start, start + resolvedSpan);
    const n = window.length;
    if (n === 0) return null;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const candle of window) {
      if (candle.low < min) min = candle.low;
      if (candle.high > max) max = candle.high;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (max === min) {
      max = min + Math.abs(min || 1) * 0.001;
    }

    const headroom = (max - min) * 0.06;
    const lower = min - headroom;
    const upper = max + headroom;
    const range = upper - lower;

    const x = (index: number) => (n === 1 ? innerWidth / 2 : (index / (n - 1)) * innerWidth);
    const y = (value: number) => PAD_TOP + (1 - (value - lower) / range) * innerHeight;

    return { min, max, x, y, window, n };
  }, [candles, count, innerWidth, innerHeight, resolvedSpan, start]);

  const pinchRef = useRef<PinchBaseline | null>(null);
  const multiRef = useRef(false);
  const suppressCrosshairRef = useRef(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const resetViewport = useCallback(() => {
    setSpan(null);
    setOffset(0);
    setActiveIndex(null);
  }, []);

  const updateActive = useCallback(
    (locationX: number) => {
      if (count === 0 || innerWidth <= 0 || suppressCrosshairRef.current) return;
      const ratio = clamp(locationX / innerWidth, 0, 1);
      setActiveIndex(start + Math.round(ratio * (resolvedSpan - 1)));
    },
    [count, innerWidth, resolvedSpan, start]
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
      const nextOffset = base.offset + (dx / Math.max(innerWidth, 1)) * nextSpan;

      setSpan(nextSpan);
      setOffset(nextOffset);

      // Incremental baseline: each move measures from the last, so a long drag
      // cannot accumulate drift away from the fingers.
      pinchRef.current = { distance, mid, span: nextSpan, offset: nextOffset };
    },
    [count, innerWidth, resolvedOffset, resolvedSpan]
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
      updateActive(locationX);
    },
    [resetViewport, updateActive]
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
      updateActive(locationX);
    },
    [handlePinch, updateActive]
  );

  const onEnd = useCallback(() => {
    pinchRef.current = null;
    multiRef.current = false;
    suppressCrosshairRef.current = false;
    setActiveIndex(null);
  }, []);

  // `PanResponder.create` is called during render, but every handler it receives is
  // only ever invoked later by the gesture system, at event time. Those handlers
  // read refs that hold gesture-local state (pinch baseline, tap timing, whether a
  // second finger is down) which has no render-time equivalent, so the generic
  // "no refs in render" rule does not apply here.
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

  if (!geometry || width === 0) {
    return <View style={{ height }} onLayout={onLayout} />;
  }

  const { x, y, window, n } = geometry;
  const first = window[0]!;
  const last = window[n - 1]!;
  const changePct = first.open === 0 ? 0 : ((last.close - first.open) / first.open) * 100;
  const tint = changePct >= 0 ? colors.up : colors.down;
  const localIndex = activeIndex === null ? -1 : activeIndex - start;
  const active = localIndex >= 0 && localIndex < n ? window[localIndex]! : null;
  const spanMs = last.time - first.time;

  let linePath = '';
  let areaPath = '';
  if (mode === 'line') {
    const points = window.map((candle, i) => `${x(i).toFixed(2)},${y(candle.close).toFixed(2)}`);
    linePath = `M${points.join('L')}`;
    areaPath = `${linePath}L${x(n - 1).toFixed(2)},${(PAD_TOP + innerHeight).toFixed(2)}L${x(0).toFixed(2)},${(PAD_TOP + innerHeight).toFixed(2)}Z`;
  }

  const bodyWidth = Math.max(1, (innerWidth / n) * 0.62);

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
            const value = geometry.max - ((geometry.max - geometry.min) / GRID_LINES) * i;
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
            window.map((candle, i) => {
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

          {Array.from({ length: X_LABELS }, (_, i) => {
            const index = Math.round((i / (X_LABELS - 1)) * (n - 1));
            const candle = window[index];
            if (!candle) return null;
            return (
              <SvgText
                key={`x-${i}`}
                x={Math.min(Math.max(x(index), 0), innerWidth - 28)}
                y={height - 4}
                fill={colors.textFaint}
                fontSize={10}
                textAnchor={i === 0 ? 'start' : i === X_LABELS - 1 ? 'end' : 'middle'}
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
                y2={PAD_TOP + innerHeight}
                stroke={colors.textMuted}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
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

      <View style={styles.axis} pointerEvents="none">
        {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
          const value = geometry.max - ((geometry.max - geometry.min) / GRID_LINES) * i;
          return (
            <Text key={`axis-${i}`} style={styles.axisLabel}>
              {formatPrice(value, decimals)}
            </Text>
          );
        })}
      </View>

      {active ? (
        <View style={styles.readout} pointerEvents="none">
          <Text style={styles.readoutPrice}>{formatPrice(active.close, decimals)}</Text>
          <Text style={styles.readoutTime}>
            {new Date(active.time).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export const PriceChart = memo(PriceChartComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
  },
  axis: {
    width: AXIS_WIDTH,
    height: '100%',
    justifyContent: 'space-between',
    paddingTop: PAD_TOP - 4,
    paddingBottom: PAD_BOTTOM,
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
    backgroundColor: colors.surfaceAlt,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    gap: 1,
  },
  readoutPrice: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  readoutTime: {
    color: colors.textFaint,
    fontSize: 10,
  },
});
