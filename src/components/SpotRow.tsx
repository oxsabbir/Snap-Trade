import {
  memo,
  useCallback } from 'react';
import { Pressable, View } from '@/components/AppLayout';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/AppText';
import { router } from 'expo-router';

import { CoinAvatar } from '@/components/CoinAvatar';
import { StarIcon } from '@/components/Icons';
import { Sparkline } from '@/components/Sparkline';
import { prefetchOrderBookSnapshot } from '@/lib/kucoin/level2';
import type { SpotMarket } from '@/lib/kucoin/types';
import { useSetActiveCoin } from '@/state/activeCoin';
import { prefetchTicker } from '@/state/ticker';
import { useTheme } from '@/theme/ThemeProvider';
import { createThemedStyles } from '@/theme/themedStyles';
import { formatCompact, formatPercent, formatPrice } from '@/utils/format';

type Props = {
  market: SpotMarket;
  isFavorite: boolean;
  onToggleFavorite: (symbol: string) => void;
};

function SpotRowComponent({ market, isFavorite, onToggleFavorite }: Props) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const isDark = scheme === 'dark';
  const isUp = market.changePercent >= 0;
  const changeColor = isUp ? (isDark ? colors.upText : '#00B982') : (isDark ? colors.downText : '#F43F5E');
  const changeBg = isUp ? (isDark ? colors.upFill : '#E5F8F1') : (isDark ? colors.downFill : '#FFE6EB');
  const volume = `Vol ${formatCompact(market.quoteVolume)} ${market.quote}`;
  const subtitle = market.baseName !== market.base ? `${market.baseName} · ${volume}` : volume;
  const setActiveCoin = useSetActiveCoin();

  const prefetchPair = useCallback(() => {
    void prefetchOrderBookSnapshot(market.symbol).catch(() => {});
    prefetchTicker(market.symbol, 3_000);
  }, [market.symbol]);

  const openTrade = useCallback(() => {
    setActiveCoin({
      symbol: market.symbol,
      name: market.baseName,
      decimals: market.priceDecimals,
    });
    router.navigate('/(tabs)/trade');
  }, [market.symbol, market.priceDecimals, market.baseName, setActiveCoin]);

  return (
    <Pressable
      onPressIn={prefetchPair}
      onPress={openTrade}
      accessibilityRole="button"
      accessibilityLabel={`Trade ${market.symbol}`}
      style={styles.pressable}
    >
      {({ pressed }) => (
        <View style={[styles.row, pressed && styles.rowPressed]}>
          <CoinAvatar symbol={market.base} size={42} />

          <View style={styles.identity}>
            <Text style={styles.symbol} numberOfLines={1}>
              {market.symbol}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>

          <View style={styles.priceBlock}>
            <Text
              style={styles.price}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {formatPrice(market.last, market.priceDecimals)}
            </Text>
            <View style={[styles.changePill, { backgroundColor: changeBg }]}>
              <Text style={[styles.change, { color: changeColor }]} numberOfLines={1}>
                {formatPercent(market.changePercent)} {isUp ? '▲' : '▼'}
              </Text>
            </View>
          </View>

          <View style={styles.chartWrap}>
            <Sparkline
              low={market.low}
              high={market.high}
              last={market.last}
              changePercent={market.changePercent}
              width={52}
              height={26}
            />
          </View>

          <Pressable
            onPress={() => onToggleFavorite(market.symbol)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityState={{ selected: isFavorite }}
            accessibilityLabel={`Favorite ${market.symbol}`}
            style={styles.star}
          >
            <StarIcon
              size={17}
              filled={isFavorite}
              color={isFavorite ? '#F5A900' : isDark ? colors.textFaint : '#8792A5'}
            />
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

export const SpotRow = memo(SpotRowComponent);

const useStyles = createThemedStyles((colors) => {
  const isDark = colors.bg === '#121212';
  return StyleSheet.create({
    pressable: {
      flexDirection: 'row',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 68,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 10,
      flex: 1,
      borderRadius: 18,
      backgroundColor: isDark ? colors.surface : '#FFFFFF',
      borderWidth: 1,
      borderColor: isDark ? colors.border : 'rgba(230, 235, 242, 0.6)',
      shadowColor: '#1E3250',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.22 : 0.07,
      shadowRadius: 12,
      elevation: 2,
    },
    rowPressed: {
      backgroundColor: isDark ? '#22252A' : '#F6F8FB',
    },
    identity: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    symbol: {
      color: isDark ? colors.text : '#111827',
      fontSize: 15,
      fontWeight: '700',
    },
    subtitle: {
      color: isDark ? colors.textMuted : '#7C879D',
      fontSize: 11,
    },
    priceBlock: {
      width: 82,
      alignItems: 'flex-end',
      gap: 4,
    },
    price: {
      color: isDark ? colors.text : '#111827',
      fontSize: 15,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    changePill: {
      paddingHorizontal: 8,
      height: 21,
      justifyContent: 'center',
      borderRadius: 11,
      minWidth: 66,
      alignItems: 'center',
    },
    change: {
      fontSize: 11,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    chartWrap: {
      width: 52,
      height: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    star: {
      width: 22,
      alignItems: 'flex-end',
    },
  });
});
