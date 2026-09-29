import { Fragment, memo, useCallback, useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { Candle, ChartMode } from '@/lib/kucoin/types';
import { colors, spacing } from '@/theme';
import { formatPrice } from '@/utils/format';

const PAD_TOP = 8;
const PAD_BOTTOM = 18;
const AXIS_WIDTH = 54;
const GRID_LINES = 4;
const X_LABELS = 4;

type Props = {
  candles: Candle[];
  mode: ChartMode;
  height?: number;
  decimals?: number;
};

function formatAxisTime(timestamp: number, spanMs: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (spanMs <= 86_400_000) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function PriceChartComponent({ candles, mode, height = 240, decimals }: Props) {
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const count = candles.length;
  const innerWidth = Math.max(width - AXIS_WIDTH, 0);
  const innerHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 0);

  const geometry = useMemo(() => {
    if (count === 0 || innerWidth <= 0) return null;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const candle of candles) {
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
    const span = upper - lower;

    const x = (index: number) => (count === 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth);
    const y = (value: number) => PAD_TOP + (1 - (value - lower) / span) * innerHeight;

    return { min, max, x, y };
  }, [candles, count, innerWidth, innerHeight]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => updateActive(event.nativeEvent.locationX),
        onPanResponderMove: (event) => updateActive(event.nativeEvent.locationX),
        onPanResponderRelease: () => setActiveIndex(null),
        onPanResponderTerminate: () => setActiveIndex(null),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, innerWidth]
  );

  function updateActive(locationX: number) {
    if (count === 0 || innerWidth <= 0) return;
    const ratio = Math.min(Math.max(locationX / innerWidth, 0), 1);
    setActiveIndex(Math.round(ratio * (count - 1)));
  }

  if (!geometry || width === 0) {
    return <View style={{ height }} onLayout={onLayout} />;
  }

  const { x, y } = geometry;
  const first = candles[0]!;
  const last = candles[count - 1]!;
  const changePct = first.open === 0 ? 0 : ((last.close - first.open) / first.open) * 100;
  const tint = changePct >= 0 ? colors.up : colors.down;
  const active = activeIndex === null ? null : candles[activeIndex];
  const spanMs = last.time - first.time;

  let linePath = '';
  let areaPath = '';
  if (mode === 'line') {
    const points = candles.map((candle, i) => `${x(i).toFixed(2)},${y(candle.close).toFixed(2)}`);
    linePath = `M${points.join('L')}`;
    areaPath = `${linePath}L${x(count - 1).toFixed(2)},${(PAD_TOP + innerHeight).toFixed(2)}L${x(0).toFixed(2)},${(PAD_TOP + innerHeight).toFixed(2)}Z`;
  }

  const bodyWidth = Math.max(1, (innerWidth / count) * 0.62);

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
            candles.map((candle, i) => {
              const isUp = candle.close >= candle.open;
              const color = isUp ? colors.up : colors.down;
              const cx = x(i);
              const bodyTop = y(Math.max(candle.open, candle.close));
              const bodyBottom = y(Math.min(candle.open, candle.close));
              return (
                <Fragment key={candle.time}>
                  <Line
                    x1={cx}
                    y1={y(candle.high)}
                    x2={cx}
                    y2={y(candle.low)}
                    stroke={color}
                    strokeWidth={1}
                  />
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
            const index = Math.round((i / (X_LABELS - 1)) * (count - 1));
            const candle = candles[index];
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
                x1={x(activeIndex!)}
                y1={PAD_TOP}
                x2={x(activeIndex!)}
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
