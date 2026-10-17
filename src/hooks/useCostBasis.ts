import { useEffect, useSyncExternalStore } from 'react';

import {
  costBasisSnapshot,
  ensureCostBasis,
  subscribeCostBasis,
  type CostBasisView,
} from '@/state/costBasis';

/**
 * Live view of one pair's average cost. The subscription is per symbol so a fill landing for
 * another pair never repaints this row, and `ensureCostBasis` runs in the background so the panel
 * mounts instantly with a placeholder and fills in when the ledger resolves.
 */
export function useCostBasis(symbol: string): CostBasisView {
  const view = useSyncExternalStore(
    (listener) => subscribeCostBasis(symbol, listener),
    () => costBasisSnapshot(symbol),
    () => costBasisSnapshot(symbol)
  );

  useEffect(() => {
    void ensureCostBasis(symbol);
  }, [symbol]);

  return view;
}
