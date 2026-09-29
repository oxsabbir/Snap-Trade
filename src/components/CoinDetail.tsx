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

import { CoinInfoSheet } from '@/components/CoinInfoSheet';
import { InfoIcon } from '@/components/Icons';
import { PriceChart } from '@/components/PriceChart';
import { TimeframeTabs } from '@/components/TimeframeTabs';
import { useLifetimeSeries } from '@/hooks/useLifetimeSeries';
import { useLiveCandles } from '@/hooks/useLiveCandles';
import { timeframeByKey, LINE_TIMEFRAME, type TimeframeOrLine } from '@/lib/kucoin/candles';
import { deriveQuote } from '@/lib/quote';
import { colors, radius, spacing } from '@/theme';
import { formatPercent, formatPrice } from '@/utils/format';

type Props = {
  symbol: string;
  name?: string;
  decimals?: number;
};

/** Timeframe a freshly opened pair starts on. */
const DEFAULT_TIMEFRAME_KEY = '1min';

export function CoinDetail({ symbol, name, decimals }: Props) {
  const [timeframeKey, setTimeframeKey] = useState(DEFAULT_TIMEFRAME_KEY);
  const [infoOpen, setInfoOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number | null>(null);
  const [chartHeight, setChartHeight] = useState(250);

  // This is one component instance shared by every pair the user opens, so opening a new
  // symbol has to put it back exactly as it looked on first open. Observed on device: a
  // symbol switch could leave the chart broken, while a timeframe switch — which changes
  // the same resetKey — always cleared it. Rather than depend on which internal state
  // happened to survive, this restores the defaults outright and the `key` on PriceChart
  // guarantees a real remount.
  //
  // chartHeight is deliberately left alone: it is measured from the layout, not chosen by
  // the user, so keeping it avoids one frame at the fallback height.
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
  const mode = isLine ? 'line' : 'candle';

  // `enabled` skips only the candle history fetch. The socket stays mounted either way,
  // because the header price, the change pill and the Live badge all read from it — and
  // the lifetime view reuses that same ticker for its last point.
  const live = useLiveCandles(symbol, timeframe, !isLine);
  const lifetime = useLifetimeSeries(symbol, isLine, live.ticker);

  const candles = isLine ? lifetime.candles : live.candles;
  const isLoading = isLine ? lifetime.isLoading : live.isLoading;
  const error = isLine ? lifetime.error : live.error;
  const refresh = isLine ? lifetime.refresh : live.refresh;
  const { ticker, status } = live;

  // Only the currently forming candle is needed for the header, so nothing here walks
  // the array. A range summary used to be computed over all 100 candles on every tick.
  const current = candles.length > 0 ? candles[candles.length - 1]! : null;

  // The header is derived from the price and the bucket open separately, because they are
  // not available at the same time. Changing timeframe clears the candles while the chart
  // refetches, but the pair — and therefore its price — has not changed, so the header must
  // stay put. The socket keeps ticking throughout, so the price stays live rather than
  // freezing on the outgoing bucket's close. See deriveQuote.
  const quote = deriveQuote(ticker?.price ?? current?.close, current?.open);
  const base = symbol.split('-')[0] ?? '';

  const onSelectTimeframe = useCallback((next: TimeframeOrLine) => setTimeframeKey(next.key), []);

  // "466 weeks · since 2017-10-19" reads as a lifetime at a glance. Absolute dates, not
  // "8 years ago", per the no-relative-date convention.
  const lineSummary = useMemo(() => {
    const first = candles[0];
    if (!first) return 'Line · loading history';
    const weeks = candles.length;
    const since = new Date(first.time);
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `Line · ${weeks} weeks · since ${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())}`;
  }, [candles]);
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

      {quote ? (
        <View style={styles.priceBlock}>
          <Text style={styles.price}>{formatPrice(quote.price, decimals)}</Text>
          {quote.change !== null ? (
            <View
              style={[
                styles.changePill,
                { backgroundColor: quote.isUp ? 'rgba(35,175,137,0.14)' : 'rgba(246,70,93,0.14)' },
              ]}
            >
              <Text style={[styles.change, { color: quote.isUp ? colors.up : colors.down }]}>
                {formatPercent(quote.change)}
              </Text>
            </View>
          ) : null}
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
          {/* This row is only ~40 characters wide before it truncates, so the Line tab
              drops the "drag to pan" nudge and the candle tabs drop the timeframe
              label — the selected tab sits directly above and already shows it. */}
          {isLine
            ? lineSummary
            : isZoomed
              ? `${visibleCount} of ${candles.length} · pan, pinch, double tap to reset`
              : `${candles.length} × ${timeframe.label} · drag to pan, pinch to zoom`}
        </Text>
      </View>

      <View style={styles.chartWrap} onLayout={onChartLayout}>
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
            <Text style={styles.errorTitle}>{isLine ? 'Could not load history' : 'Could not load candles'}</Text>
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
            hideVolume={isLine}
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
    alignItems: 'center',
    gap: spacing.sm,
  },
  loaderCaption: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
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
