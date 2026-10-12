import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import TradeRoute from '../(tabs)/trade';
import { fetchSymbols } from '@/lib/kucoin/market';
import { useSetActiveCoin } from '@/state/activeCoin';

export default function TradeSymbolRoute() {
  const { symbol } = useLocalSearchParams<{ symbol?: string }>();
  const setActiveCoin = useSetActiveCoin();

  useEffect(() => {
    if (!symbol) return;

    const normalized = decodeURIComponent(String(symbol)).trim().toUpperCase();
    if (!normalized) return;

    let cancelled = false;

    const resolveSymbol = async () => {
      try {
        const symbols = await fetchSymbols();
        const match = symbols.find((item) => item.symbol.toUpperCase() === normalized);
        const fallback = normalized.includes('-') ? normalized : `${normalized}-USDT`;
        const resolved = match?.symbol?.toUpperCase() ?? fallback;
        const [base = normalized] = resolved.split('-');

        if (!cancelled) {
          setActiveCoin({
            symbol: resolved,
            name: base,
            decimals: 8,
          });
          console.log('🔗 Trade deep link resolved to active coin:', resolved);
        }
      } catch (error) {
        console.warn('🔗 Failed to resolve deep link symbol:', symbol, error);
        if (!cancelled) {
          setActiveCoin({
            symbol: normalized.includes('-') ? normalized : `${normalized}-USDT`,
            name: normalized.replace('-USDT', ''),
            decimals: 8,
          });
        }
      }
    };

    void resolveSymbol();
    return () => {
      cancelled = true;
    };
  }, [setActiveCoin, symbol]);

  return <TradeRoute />;
}
