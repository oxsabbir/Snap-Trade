import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChartModeToggle } from '@/components/ChartModeToggle';
import { CoinInfoSheet } from '@/components/CoinInfoSheet';
import { InfoIcon } from '@/components/Icons';
import { PriceChart } from '@/components/PriceChart';
import { TimeframeTabs } from '@/components/TimeframeTabs';
import { useLiveCandles } from '@/hooks/useLiveCandles';
import { timeframeByKey, type Timeframe } from '@/lib/kucoin/candles';
import type { ChartMode } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';
import { formatPercent, formatPrice } from '@/utils/format';

type Props = {
  symbol: string;
  name?: string;
  decimals?: number;
};

export function CoinDetail({ symbol, name, decimals }: Props) {
  const [timeframeKey, setTimeframeKey] = useState('1hour');
  const [mode, setMode] = useState<ChartMode>('line');
  const [infoOpen, setInfoOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [chartHeight, setChartHeight] = useState(250);

  const timeframe = useMemo(() => timeframeByKey(timeframeKey), [timeframeKey]);
  const { candles, ticker, status, isLoading, error, refresh } = useLiveCandles(symbol, timeframe);

  // Only the currently forming candle is needed for the header, so nothing here walks
  // the array. A range summary used to be computed over all 100 candles on every tick.
  const current = candles.length > 0 ? candles[candles.length - 1]! : null;

  const livePrice = ticker?.price ?? current?.close;
  // Measured against the current candle's open, so the pill matches the selected
  // timeframe. Using the oldest of the 100 loaded candles would report, say, four
  // days of change next to a live 1H price.
  const change =
    current && current.open !== 0 && livePrice !== undefined
      ? ((livePrice - current.open) / current.open) * 100
      : 0;
  const isUp = change >= 0;
  const base = symbol.split('-')[0] ?? '';

  const onSelectTimeframe = useCallback((next: Timeframe) => setTimeframeKey(next.key), []);
  const onOpenInfo = useCallback(() => setInfoOpen(true), []);
  const onCloseInfo = useCallback(() => setInfoOpen(false), []);
  const onVisibleRangeChange = useCallback((visible: number) => setVisibleCount(visible), []);
  // The chart takes whatever height is left over rather than a fixed number, so it
  // fills the screen instead of leaving a gap where the stats grid used to be.
  const onChartLayout = useCallback((event: LayoutChangeEvent) => {
    setChartHeight(Math.max(Math.round(event.nativeEvent.layout.height), 200));
  }, []);
  const isZoomed = visibleCount !== null && visibleCount < candles.length;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.symbol}>{symbol || '—'}</Text>
          {name && name !== base ? <Text style={styles.name}>{name}</Text> : null}
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

      {current ? (
        <View style={styles.priceBlock}>
          <Text style={styles.price}>{formatPrice(livePrice ?? 0, decimals)}</Text>
          <View
            style={[
              styles.changePill,
              { backgroundColor: isUp ? 'rgba(35,175,137,0.14)' : 'rgba(246,70,93,0.14)' },
            ]}
          >
            <Text style={[styles.change, { color: isUp ? colors.up : colors.down }]}>
              {formatPercent(change)}
            </Text>
          </View>
          <View style={styles.liveBadge}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: status === 'live' ? colors.up : colors.textFaint },
              ]}
            />
            <Text style={styles.liveText}>
              {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.timeframeRow}>
        <TimeframeTabs value={timeframeKey} onChange={onSelectTimeframe} />
      </View>

      <View style={styles.toolbar}>
        <Text style={styles.periodLabel} numberOfLines={1}>
          {isZoomed
            ? `${visibleCount} of ${candles.length} × ${timeframe.label} · double tap to reset`
            : `${candles.length} × ${timeframe.label} · drag to pan, pinch to zoom`}
        </Text>
        <ChartModeToggle value={mode} onChange={setMode} />
      </View>

      <View style={styles.chartWrap} onLayout={onChartLayout}>
        {isLoading && candles.length === 0 ? (
          <ActivityIndicator style={styles.loader} color={colors.accent} />
        ) : error && candles.length === 0 ? (
          <Pressable style={styles.errorBox} onPress={refresh}>
            <Text style={styles.errorTitle}>Could not load candles</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorHint}>Tap to retry.</Text>
          </Pressable>
        ) : (
          <PriceChart
            candles={candles}
            mode={mode}
            height={chartHeight}
            decimals={decimals}
            resetKey={`${symbol}:${timeframe.key}`}
            onVisibleRangeChange={onVisibleRangeChange}
          />
        )}
      </View>

      <CoinInfoSheet symbol={symbol} visible={infoOpen} onClose={onCloseInfo} decimals={decimals} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontWeight: '700',
  },
  name: {
    color: colors.textFaint,
    fontSize: 11,
  },
  priceBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  price: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  changePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  change: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  timeframeRow: {
    flexGrow: 0,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  periodLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  chartWrap: {
    flex: 1,
    minHeight: 220,
    justifyContent: 'center',
  },
  loader: {
    alignSelf: 'center',
  },
  errorBox: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
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
