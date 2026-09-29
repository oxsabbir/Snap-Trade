import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChartModeToggle } from '@/components/ChartModeToggle';
import { PriceChart } from '@/components/PriceChart';
import { TimeframeTabs } from '@/components/TimeframeTabs';
import { useLiveCandles } from '@/hooks/useLiveCandles';
import { priceExtremes, timeframeByKey, type Timeframe } from '@/lib/kucoin/candles';
import type { ChartMode } from '@/lib/kucoin/types';
import { colors, radius, spacing } from '@/theme';
import { formatCompact, formatPercent, formatPrice } from '@/utils/format';

type Props = {
  symbol: string;
  name?: string;
  decimals?: number;
};

export function CoinDetail({ symbol, name, decimals }: Props) {
  const [timeframeKey, setTimeframeKey] = useState('1hour');
  const [mode, setMode] = useState<ChartMode>('line');

  const timeframe = useMemo(() => timeframeByKey(timeframeKey), [timeframeKey]);
  const { candles, ticker, status, isLoading, error, refresh } = useLiveCandles(symbol, timeframe);

  const stats = useMemo(() => {
    if (candles.length === 0) return null;
    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    const { low, high } = priceExtremes(candles);
    let volume = 0;
    let turnover = 0;
    for (const candle of candles) {
      volume += candle.volume;
      turnover += candle.turnover;
    }
    return { open: first.open, high, low, close: last.close, volume, turnover };
  }, [candles]);

  const livePrice = ticker?.price ?? stats?.close;
  const change = stats && stats.open !== 0 ? (((livePrice ?? stats.close) - stats.open) / stats.open) * 100 : 0;
  const isUp = change >= 0;
  const [base, quote] = symbol.split('-');

  const onSelectTimeframe = useCallback((next: Timeframe) => setTimeframeKey(next.key), []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.symbol}>{symbol || '—'}</Text>
          {name && name !== base ? <Text style={styles.name}>{name}</Text> : null}
        </View>
      </View>

      {stats ? (
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
        <Text style={styles.periodLabel}>
          {candles.length} × {timeframe.label}
        </Text>
        <ChartModeToggle value={mode} onChange={setMode} />
      </View>

      <View style={styles.chartWrap}>
        {isLoading && candles.length === 0 ? (
          <ActivityIndicator style={styles.loader} color={colors.accent} />
        ) : error && candles.length === 0 ? (
          <Pressable style={styles.errorBox} onPress={refresh}>
            <Text style={styles.errorTitle}>Could not load candles</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorHint}>Tap to retry.</Text>
          </Pressable>
        ) : (
          <PriceChart candles={candles} mode={mode} decimals={decimals} />
        )}
      </View>

      {stats ? (
        <View style={styles.statsGrid}>
          <Stat label="Open" value={formatPrice(stats.open, decimals)} />
          <Stat label="High" value={formatPrice(stats.high, decimals)} />
          <Stat label="Low" value={formatPrice(stats.low, decimals)} />
          <Stat label="Close" value={formatPrice(stats.close, decimals)} />
          <Stat label={`Volume (${base})`} value={formatCompact(stats.volume)} />
          <Stat label={`Turnover (${quote})`} value={formatCompact(stats.turnover)} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
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
  },
  chartWrap: {
    minHeight: 240,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stat: {
    width: '50%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 3,
  },
  statLabel: {
    color: colors.textFaint,
    fontSize: 11,
  },
  statValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
