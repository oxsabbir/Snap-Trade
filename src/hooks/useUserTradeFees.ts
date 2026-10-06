import { useEffect, useState } from 'react';

import { fetchMarketStats } from '@/lib/kucoin/market';
import { getKcsDiscountEnabled } from '@/state/kcsDiscount';

export function useUserTradeFees(symbol: string): {
  takerFeeRate: string | null;
  isLoading: boolean;
} {
  const [takerFeeRate, setTakerFeeRate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kcsEnabled = await getKcsDiscountEnabled();
      const stats = await fetchMarketStats(symbol);
      if (cancelled) return;
      // actual taker fee = base class rate × VIP coefficient × KCS discount
      const base = parseFloat(stats.takerFeeRate);
      const coeff = parseFloat(stats.takerCoefficient);
      const kcsMult = kcsEnabled ? 0.8 : 1;
      const actual = (base * coeff * kcsMult).toFixed(6);
      setTakerFeeRate(actual);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  return { takerFeeRate, isLoading };
}