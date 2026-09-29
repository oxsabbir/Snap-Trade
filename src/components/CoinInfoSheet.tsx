import { memo } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CloseIcon } from '@/components/Icons';
import { Stat } from '@/components/Stat';
import { useCoinInfo } from '@/hooks/useCoinInfo';
import { colors, radius, spacing } from '@/theme';
import { formatCompact, formatPrice, formatRate, parseNumber } from '@/utils/format';

type Props = {
  symbol: string;
  visible: boolean;
  onClose: () => void;
  decimals?: number;
};

function flag(enabled: boolean | undefined): { label: string; tone: 'up' | 'down' | 'default' } {
  if (enabled === undefined) return { label: '—', tone: 'default' };
  return enabled ? { label: 'Enabled', tone: 'up' } : { label: 'Disabled', tone: 'default' };
}

function CoinInfoSheetComponent({ symbol, visible, onClose, decimals }: Props) {
  const insets = useSafeAreaInsets();
  const { stats, symbolInfo, currency, isLoading, error, refresh } = useCoinInfo(symbol, visible);

  const [base, quote] = symbol.split('-');
  const high = parseNumber(stats?.high);
  const low = parseNumber(stats?.low);
  const last = parseNumber(stats?.last);
  const buy = parseNumber(stats?.buy);
  const sell = parseNumber(stats?.sell);
  const changeRate = parseNumber(stats?.changeRate);
  const spread = buy !== null && sell !== null ? sell - buy : null;
  const spreadBps = spread !== null && buy ? (spread / buy) * 10_000 : null;
  const changeTone = (changeRate ?? 0) >= 0 ? 'up' : 'down';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close coin info" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.grabber} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.symbol}>{symbol}</Text>
            <Text style={styles.fullName} numberOfLines={1}>
              {currency?.fullName || symbolInfo?.name || '—'}
            </Text>
          </View>
          {symbolInfo?.market ? <Text style={styles.badge}>{symbolInfo.market}</Text> : null}
          <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityLabel="Close">
            <CloseIcon size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator style={styles.loader} color={colors.accent} />
        ) : error ? (
          <Pressable style={styles.errorBox} onPress={refresh}>
            <Text style={styles.errorTitle}>Could not load coin info</Text>
            <Text style={styles.errorBody} numberOfLines={3}>
              {error}
            </Text>
            <Text style={styles.errorHint}>Tap to retry.</Text>
          </Pressable>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Section title="24 hour">
              <View style={styles.grid}>
                <Stat label="Last" value={last === null ? '—' : formatPrice(last, decimals)} />
                <Stat
                  label="Change"
                  value={changeRate === null ? '—' : formatRate(changeRate)}
                  tone={changeTone}
                />
                <Stat label="High" value={high === null ? '—' : formatPrice(high, decimals)} />
                <Stat label="Low" value={low === null ? '—' : formatPrice(low, decimals)} />
                <Stat
                  label={`Volume (${base ?? ''})`}
                  value={formatCompact(parseNumber(stats?.vol) ?? 0)}
                />
                <Stat
                  label={`Value (${quote ?? ''})`}
                  value={formatCompact(parseNumber(stats?.volValue) ?? 0)}
                />
                <Stat
                  label="Average price"
                  value={formatPrice(parseNumber(stats?.averagePrice) ?? 0, decimals)}
                />
                <Stat
                  label="Best bid / ask"
                  value={`${buy === null ? '—' : formatPrice(buy, decimals)} / ${
                    sell === null ? '—' : formatPrice(sell, decimals)
                  }`}
                />
                <Stat
                  label="Spread"
                  value={spread === null ? '—' : `${formatPrice(spread, decimals)}`}
                  hint={spreadBps === null ? undefined : `${spreadBps.toFixed(2)} bps`}
                />
              </View>
            </Section>

            <Section title="Fees">
              <View style={styles.grid}>
                <Stat
                  label="Maker"
                  value={formatRate(parseNumber(stats?.makerFeeRate) ?? NaN)}
                  hint="You receive"
                />
                <Stat
                  label="Taker"
                  value={formatRate(parseNumber(stats?.takerFeeRate) ?? NaN)}
                  hint="You pay"
                />
              </View>
              <Text style={styles.note}>
                Your account tier can differ from this base schedule. Rates are quoted in the fee currency.
              </Text>
            </Section>

            <Section title="Trading limits">
              <View style={styles.grid}>
                <Stat
                  label="Price increment"
                  value={symbolInfo?.priceIncrement ?? '—'}
                  hint={symbolInfo ? `${decimals ?? '—'} decimals` : undefined}
                />
                <Stat
                  label="Price limit rate"
                  value={
                    parseNumber(symbolInfo?.priceLimitRate) === null
                      ? '—'
                      : formatRate(parseNumber(symbolInfo?.priceLimitRate) ?? 0)
                  }
                  hint="Per order"
                />
                <Stat label="Min funds" value={symbolInfo?.minFunds || '—'} />
                <Stat label="Base increment" value={symbolInfo?.baseIncrement ?? '—'} />
                <Stat
                  label={`Base size (${base ?? ''})`}
                  value={
                    symbolInfo
                      ? `${formatAmount2(symbolInfo.baseMinSize)} – ${symbolInfo.baseMaxSize || '∞'}`
                      : '—'
                  }
                />
                <Stat
                  label={`Quote size (${quote ?? ''})`}
                  value={
                    symbolInfo
                      ? `${formatAmount2(symbolInfo.quoteMinSize)} – ${symbolInfo.quoteMaxSize || '∞'}`
                      : '—'
                  }
                />
              </View>
            </Section>

            <Section title={`${base ?? ''} asset`}>
              <View style={styles.grid}>
                <Stat label="Precision" value={currency?.precision !== undefined ? String(currency.precision) : '—'} />
                <Stat
                  label="Confirmations"
                  value={currency?.confirms !== undefined ? String(currency.confirms) : '—'}
                />
                <Stat
                  label="Withdrawal min"
                  value={currency?.withdrawalMinSize || '—'}
                  hint={currency?.withdrawalMinFee ? `Fee ${currency.withdrawalMinFee}` : undefined}
                />
                <Stat label="Deposit" value={flag(currency?.isDepositEnabled).label} />
                <Stat label="Withdrawal" value={flag(currency?.isWithdrawEnabled).label} />
                <Stat label="Margin trading" value={flag(symbolInfo?.isMarginEnabled).label} />
              </View>
              {currency?.contractAddress ? (
                <Stat
                  columns={1}
                  label="Contract address"
                  value={currency.contractAddress}
                />
              ) : null}
            </Section>

            <Text style={styles.disclaimer}>
              Public market data only. This panel does not query your account and is not investment advice.
            </Text>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function formatAmount2(value: string | undefined): string {
  const parsed = parseNumber(value);
  return parsed === null ? '—' : formatCompact(parsed, 4);
}

export const CoinInfoSheet = memo(CoinInfoSheetComponent);

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  symbol: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  fullName: {
    color: colors.textFaint,
    fontSize: 12,
  },
  badge: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  close: {
    padding: spacing.xs,
  },
  loader: {
    paddingVertical: spacing.xl,
  },
  errorBox: {
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    gap: spacing.xs,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  errorHint: {
    color: colors.textFaint,
    fontSize: 11,
  },
  scroll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  note: {
    color: colors.textFaint,
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  disclaimer: {
    color: colors.textFaint,
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
});
