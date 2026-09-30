import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CartesianChart, Candlestick, useChartTransformState } from 'victory-native';

import { colors, radius, spacing } from '@/theme';

/**
 * Temporary spike route: proves Skia + Reanimated + Victory render in this Expo Go build before
 * the real chart is rewritten. Static data, no socket, not part of the app's navigation.
 * Delete once verified.
 */

const CANDLES = Array.from({ length: 60 }, (_, i) => {
  // A gentle wave so candles have visible wicks and both up and down bodies.
  const base = 100 + Math.sin(i / 6) * 8 + i * 0.35;
  const open = base;
  const close = base + Math.sin(i / 3) * 1.4;
  return {
    time: 1_700_000_000 + i * 3_600_000,
    open,
    high: Math.max(open, close) + 0.9,
    low: Math.min(open, close) - 0.9,
    close,
  };
});

export default function ChartSpike() {
  const transformState = useChartTransformState().state;

  const xLabel = useMemo(
    () => (value: number) => new Date(value * 1000).toISOString().slice(11, 16),
    []
  );
  const yLabel = useMemo(() => (value: number) => value.toFixed(2), []);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Victory XL spike</Text>
      <Text style={styles.hint}>Drag to pan · pinch to zoom · static data</Text>

      <View style={styles.chart}>
        <CartesianChart
          data={CANDLES}
          xKey="time"
          yKeys={['open', 'high', 'low', 'close']}
          padding={{ left: 8, right: 8, top: 8, bottom: 8 }}
          transformState={transformState}
          axisOptions={{
            tickCount: { x: 4, y: 4 },
            axisSide: { x: 'bottom', y: 'right' },
            formatXLabel: xLabel,
            formatYLabel: yLabel,
            lineColor: { grid: colors.border, frame: colors.border },
            labelColor: colors.textMuted,
          }}
        >
          {({ points, chartBounds }) => (
            <Candlestick
              openPoints={points.open}
              highPoints={points.high}
              lowPoints={points.low}
              closePoints={points.close}
              chartBounds={chartBounds}
              candleColors={{ positive: colors.up, negative: colors.down }}
            />
          )}
        </CartesianChart>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 2, marginBottom: spacing.md },
  chart: {
    height: 320,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
