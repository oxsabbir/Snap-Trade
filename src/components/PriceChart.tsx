import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { Canvas, Circle, Group, Line, LinearGradient, Path, Rect, Skia, vec } from '@shopify/react-native-skia';

import type { Candle, ChartMode } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';
import { formatAmount, formatPercent, formatPrice } from '@/utils/format';

const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const AXIS_WIDTH = 54;
const GRID_LINES = 4;
const X_LABELS = 4;
const MIN_VISIBLE = 20;
const DEFAULT_SPAN = 35;
const CANDLE_BODY_RATIO = 0.72;

type Props = { candles: Candle[]; mode: ChartMode; height?: number; decimals?: number; defaultSpan?: number; resetKey?: string; onVisibleRangeChange?: (visible: number, total: number) => void };
type Viewport = { span: number; offset: number };
type Domain = { lower: number; upper: number };

function clamp(value: number, min: number, max: number): number { 'worklet'; return Math.min(Math.max(value, min), max); }
function resolveSpan(count: number, span: number): number { 'worklet'; return count <= 0 ? 0 : clamp(Math.round(span), Math.min(MIN_VISIBLE, count), count); }
function initialViewport(count: number, defaultSpan?: number): Viewport { return { span: resolveSpan(count, defaultSpan ?? DEFAULT_SPAN), offset: 0 }; }

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const mantissa = raw / magnitude;
  return (mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10) * magnitude;
}

function niceBand(min: number, max: number): Domain {
  const span = max > min ? max - min : Math.abs(max || 1) * 0.01;
  const gap = niceStep(span / GRID_LINES);
  const lower = Math.floor(min / gap) * gap;
  const upper = Math.ceil(max / gap) * gap;
  return upper > lower ? { lower, upper } : { lower: lower - gap, upper: upper + gap };
}

function formatAxisTime(timestamp: number, spanMs: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (spanMs <= 86_400_000) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (spanMs > 63_072_000_000) return date.getFullYear().toString();
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function PriceChartComponent({ candles: incomingCandles, mode, height = 250, decimals, defaultSpan, resetKey, onVisibleRangeChange }: Props) {
  // Socket bursts may update the source several times per second. The canvas adopts the latest
  // deferred snapshot, leaving the UI runtime free to keep an in-flight gesture responsive.
  const candles = useDeferredValue(incomingCandles);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(() => initialViewport(incomingCandles.length, defaultSpan));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const resetId = `${resetKey ?? ''}:${incomingCandles.length}:${defaultSpan ?? ''}`;
  const [activeResetId, setActiveResetId] = useState(resetId);
  if (resetId !== activeResetId) {
    setActiveResetId(resetId);
    setViewport(initialViewport(incomingCandles.length, defaultSpan));
    setActiveIndex(null);
  }
  const count = candles.length;
  const innerWidth = Math.max(width - AXIS_WIDTH, 0);
  const priceHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 1);
  const settledSpan = resolveSpan(count, viewport.span);
  const settledOffset = clamp(viewport.offset, 0, Math.max(count - settledSpan, 0));
  const settledStart = Math.max(count - settledOffset - settledSpan, 0);

  const zoomSpan = useSharedValue(settledSpan || 1);
  const zoomOffset = useSharedValue(settledOffset);
  const panStartOffset = useSharedValue(0);
  const pinchStartSpan = useSharedValue(settledSpan || 1);
  const pinchStartOffset = useSharedValue(settledOffset);

  useEffect(() => {
    zoomSpan.set(settledSpan || 1);
    zoomOffset.set(settledOffset);
  }, [settledOffset, settledSpan, zoomOffset, zoomSpan]);

  useEffect(() => { if (count > 0) onVisibleRangeChange?.(settledSpan, count); }, [count, onVisibleRangeChange, settledSpan]);

  const window = useMemo(() => {
    const visible = candles.slice(settledStart, settledStart + settledSpan);
    if (visible.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const candle of visible) { min = Math.min(min, candle.low); max = Math.max(max, candle.high); }
    return { candles: visible, domain: niceBand(min, max) };
  }, [candles, settledSpan, settledStart]);

  const domain = window?.domain;
  const geometry = useMemo(() => {
    if (!domain || count === 0 || innerWidth <= 0) return null;
    const range = domain.upper - domain.lower;
    const x = (index: number) => count === 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth;
    const y = (value: number) => PAD_TOP + (1 - (value - domain.lower) / range) * priceHeight;
    const linePath = Skia.Path.Make();
    const areaPath = Skia.Path.Make();
    if (mode === 'line') {
      candles.forEach((candle, index) => {
        const px = x(index); const py = y(candle.close);
        if (index === 0) { linePath.moveTo(px, py); areaPath.moveTo(px, py); }
        else { linePath.lineTo(px, py); areaPath.lineTo(px, py); }
      });
      if (count > 1) { areaPath.lineTo(x(count - 1), PAD_TOP + priceHeight); areaPath.lineTo(x(0), PAD_TOP + priceHeight); areaPath.close(); }
    }
    return { x, y, linePath, areaPath, bodyWidth: Math.max(1, (innerWidth / Math.max(count, 1)) * CANDLE_BODY_RATIO) };
  }, [candles, count, domain, innerWidth, mode, priceHeight]);

  // This transform is evaluated on Reanimated's UI runtime. Pan and pinch redraw Skia without
  // creating React elements, re-slicing arrays, or sending touch events through the JS thread.
  const chartTransform = useDerivedValue(() => {
    const visible = resolveSpan(count, zoomSpan.get());
    const offset = clamp(zoomOffset.get(), 0, Math.max(count - visible, 0));
    const start = Math.max(count - offset - visible, 0);
    const scaleX = count <= 1 || visible <= 1 ? 1 : (count - 1) / (visible - 1);
    const step = innerWidth / Math.max(count - 1, 1);
    return [{ scaleX }, { translateX: -start * step * scaleX }];
  }, [count, innerWidth, zoomOffset, zoomSpan]);

  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const commitViewport = useCallback((span: number, offset: number) => {
    const nextSpan = resolveSpan(candles.length, span);
    setViewport({ span: nextSpan, offset: clamp(Math.round(offset), 0, Math.max(candles.length - nextSpan, 0)) });
  }, [candles.length]);
  const resetViewport = useCallback(() => {
    const next = initialViewport(candles.length, defaultSpan);
    zoomSpan.set(next.span || 1); zoomOffset.set(0); setViewport(next); setActiveIndex(null);
  }, [candles.length, defaultSpan, zoomOffset, zoomSpan]);
  const selectAt = useCallback((x: number) => {
    if (!geometry || settledSpan === 0) return;
    const index = settledStart + Math.round(clamp(x / Math.max(innerWidth, 1), 0, 1) * (settledSpan - 1));
    setActiveIndex((previous) => previous === index ? null : index);
  }, [geometry, innerWidth, settledSpan, settledStart]);
  const clearActive = useCallback(() => setActiveIndex(null), []);

  const pan = useMemo(() => Gesture.Pan().activeOffsetX([-6, 6]).failOffsetY([-14, 14])
    .onBegin(() => { panStartOffset.set(zoomOffset.get()); runOnJS(clearActive)(); })
    .onUpdate((event) => { const span = resolveSpan(count, zoomSpan.get()); const next = panStartOffset.get() + (event.translationX / Math.max(innerWidth, 1)) * span; zoomOffset.set(clamp(next, 0, Math.max(count - span, 0))); })
    .onEnd(() => runOnJS(commitViewport)(zoomSpan.get(), zoomOffset.get())),
  [clearActive, commitViewport, count, innerWidth, panStartOffset, zoomOffset, zoomSpan]);
  const pinch = useMemo(() => Gesture.Pinch()
    .onBegin(() => { pinchStartSpan.set(zoomSpan.get()); pinchStartOffset.set(zoomOffset.get()); runOnJS(clearActive)(); })
    .onUpdate((event) => { const span = resolveSpan(count, pinchStartSpan.get() / Math.max(event.scale, 0.01)); const shift = ((event.focalX - innerWidth / 2) / Math.max(innerWidth, 1)) * span; zoomSpan.set(span); zoomOffset.set(clamp(pinchStartOffset.get() + shift, 0, Math.max(count - span, 0))); })
    .onEnd(() => runOnJS(commitViewport)(zoomSpan.get(), zoomOffset.get())),
  [clearActive, commitViewport, count, innerWidth, pinchStartOffset, pinchStartSpan, zoomOffset, zoomSpan]);
  const singleTap = useMemo(() => Gesture.Tap().onEnd((event, success) => { if (success) runOnJS(selectAt)(event.x); }), [selectAt]);
  const doubleTap = useMemo(() => Gesture.Tap().numberOfTaps(2).onEnd((_event, success) => { if (success) runOnJS(resetViewport)(); }), [resetViewport]);
  const gestures = useMemo(() => Gesture.Simultaneous(pan, pinch, Gesture.Exclusive(doubleTap, singleTap)), [doubleTap, pan, pinch, singleTap]);

  if (!window || !geometry || !domain || width === 0) return <View style={{ height }} onLayout={onLayout} />;

  const visible = window.candles;
  const first = visible[0]!;
  const last = visible[visible.length - 1]!;
  const tint = last.close >= first.open ? colors.up : colors.down;
  const active = activeIndex === null ? null : candles[activeIndex] ?? null;
  const activeX = activeIndex === null ? 0 : geometry.x(activeIndex);
  const activeY = active ? geometry.y(active.close) : 0;
  const spanMs = last.time - first.time;

  return <View style={styles.container} onLayout={onLayout}>
    <GestureDetector gesture={gestures}>
      <View style={{ width: innerWidth, height }}>
        <Canvas style={styles.canvas}>
          {Array.from({ length: GRID_LINES + 1 }, (_, index) => { const value = domain.upper - ((domain.upper - domain.lower) / GRID_LINES) * index; const y = geometry.y(value); return <Line key={`grid-${index}`} p1={vec(0, y)} p2={vec(innerWidth, y)} color={colors.border} strokeWidth={StyleSheet.hairlineWidth} />; })}
          <Group transform={chartTransform} clip={{ x: 0, y: 0, width: innerWidth, height }}>
            {mode === 'line' ? (count === 1 ? <Circle cx={geometry.x(0)} cy={geometry.y(last.close)} r={3} color={tint} /> : <><Path path={geometry.areaPath} color={tint} opacity={0.2}><LinearGradient start={vec(0, PAD_TOP)} end={vec(0, PAD_TOP + priceHeight)} colors={[tint, 'transparent']} /></Path><Path path={geometry.linePath} color={tint} style="stroke" strokeWidth={1.6} strokeJoin="round" strokeCap="round" /></>) : candles.map((candle, index) => {
              const up = candle.close >= candle.open; const color = up ? colors.up : colors.down; const cx = geometry.x(index); const top = geometry.y(Math.max(candle.open, candle.close)); const bottom = geometry.y(Math.min(candle.open, candle.close));
              return <Group key={candle.time}><Line p1={vec(cx, geometry.y(candle.high))} p2={vec(cx, geometry.y(candle.low))} color={color} strokeWidth={1} /><Rect x={cx - geometry.bodyWidth / 2} y={top} width={geometry.bodyWidth} height={Math.max(bottom - top, 1)} color={color} opacity={up ? 0.85 : 1} /></Group>;
            })}
            {active ? <><Line p1={vec(activeX, PAD_TOP)} p2={vec(activeX, PAD_TOP + priceHeight)} color={colors.textMuted} strokeWidth={1} /><Line p1={vec(0, activeY)} p2={vec(innerWidth, activeY)} color={colors.textMuted} strokeWidth={1} /></> : null}
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
    <View style={{ width: AXIS_WIDTH, height }}><View style={{ marginTop: PAD_TOP, height: priceHeight, justifyContent: 'space-between' }}>{Array.from({ length: GRID_LINES + 1 }, (_, index) => { const value = domain.upper - ((domain.upper - domain.lower) / GRID_LINES) * index; return <Text key={`axis-${index}`} style={styles.axisLabel}>{formatPrice(value, decimals)}</Text>; })}</View></View>
    {Array.from({ length: X_LABELS }, (_, index) => { const candle = visible[Math.round((index / (X_LABELS - 1)) * (visible.length - 1))]; if (!candle) return null; const left = (index / (X_LABELS - 1)) * Math.max(innerWidth - 44, 0); return <Text key={`time-${index}`} style={[styles.timeLabel, { left }]}>{formatAxisTime(candle.time, spanMs)}</Text>; })}
    {active ? <Readout candle={active} decimals={decimals} /> : null}
  </View>;
}

function Readout({ candle, decimals }: { candle: Candle; decimals?: number }) {
  return <View style={styles.readout} pointerEvents="none"><Text style={styles.readoutTime}>{new Date(candle.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text><View style={styles.readoutGrid}><OhlcCell label="O" value={formatPrice(candle.open, decimals)} /><OhlcCell label="H" value={formatPrice(candle.high, decimals)} /><OhlcCell label="L" value={formatPrice(candle.low, decimals)} /><OhlcCell label="C" value={formatPrice(candle.close, decimals)} /></View><Text style={styles.readoutVolume}>Vol {formatAmount(candle.volume)}{candle.open !== 0 ? `  ${formatPercent(((candle.close - candle.open) / candle.open) * 100)}` : ''}</Text></View>;
}
function OhlcCell({ label, value }: { label: string; value: string }) { return <View style={styles.ohlcCell}><Text style={styles.ohlcLabel}>{label}</Text><Text style={styles.ohlcValue}>{value}</Text></View>; }

export const PriceChart = memo(PriceChartComponent);

const styles = StyleSheet.create({
  container: { flexDirection: 'row', position: 'relative' }, canvas: { flex: 1 }, axisLabel: { color: colors.textFaint, fontSize: 10, textAlign: 'right' }, timeLabel: { position: 'absolute', bottom: 2, color: colors.textFaint, fontSize: 10, width: 44, textAlign: 'center' },
  readout: { position: 'absolute', top: spacing.xs, left: spacing.xs, backgroundColor: 'rgba(23,24,26,0.94)', borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 6, gap: 3 }, readoutTime: { color: colors.textMuted, fontSize: 10, fontWeight: '600' }, readoutGrid: { flexDirection: 'row', gap: spacing.md }, ohlcCell: { flexDirection: 'row', alignItems: 'center', gap: 3 }, ohlcLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '700' }, ohlcValue: { color: colors.text, fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] }, readoutVolume: { color: colors.textMuted, fontSize: 10, fontVariant: ['tabular-nums'] },
});
