import { useEffect, useState } from 'react';

import { fetchMarketStats, getCachedMarketStats } from '@/lib/kucoin/market';
import { getCachedKcsDiscountEnabled, getKcsDiscountEnabled } from '@/state/kcsDiscount';

function computeFeeRate(takerFeeRate: string, takerCoefficient: string, kcsEnabled: boolean): string {
  // actual taker fee = base class rate × VIP coefficient × KCS discount
  const base = parseFloat(takerFeeRate);
  const coeff = parseFloat(takerCoefficient);
  const kcsMult = kcsEnabled ? 0.8 : 1;
  return (base * coeff * kcsMult).toFixed(6);
}

function initialFeeRate(symbol: string): string | null {
  const kcsEnabled = getCachedKcsDiscountEnabled();
  const stats = getCachedMarketStats(symbol);
  if (kcsEnabled === null || !stats) return null;
  return computeFeeRate(stats.takerFeeRate, stats.takerCoefficient, kcsEnabled);
}

export function useUserTradeFees(symbol: string): {
  takerFeeRate: string | null;
  isLoading: boolean;
} {
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const [takerFeeRate, setTakerFeeRate] = useState<string | null>(() => initialFeeRate(symbol));
  const [isLoading, setIsLoading] = useState(() => initialFeeRate(symbol) === null);

  if (symbol !== activeSymbol) {
    setActiveSymbol(symbol);
    const cached = initialFeeRate(symbol);
    setTakerFeeRate(cached);
    setIsLoading(cached === null);
  }

  useEffect(() => {
    if (initialFeeRate(symbol) !== null) return;
    let cancelled = false;
    (async () => {
      const [kcsEnabled, stats] = await Promise.all([
        getKcsDiscountEnabled(),
        fetchMarketStats(symbol),
      ]);
      if (cancelled) return;
      setTakerFeeRate(computeFeeRate(stats.takerFeeRate, stats.takerCoefficient, kcsEnabled));
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  return { takerFeeRate, isLoading };
}