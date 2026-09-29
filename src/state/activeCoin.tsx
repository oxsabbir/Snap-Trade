import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'trade:active-coin';

export type ActiveCoin = {
  symbol: string;
  name: string;
  decimals: number;
};

type ActiveCoinActions = {
  setActiveCoin: (coin: ActiveCoin) => void;
};

const ActiveCoinStateContext = createContext<ActiveCoin | null | undefined>(undefined);
const ActiveCoinActionsContext = createContext<ActiveCoinActions | undefined>(undefined);

function isActiveCoin(value: unknown): value is ActiveCoin {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ActiveCoin>;
  return (
    typeof candidate.symbol === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.decimals === 'number'
  );
}

export function ActiveCoinProvider({ children }: { children: ReactNode }) {
  const [coin, setCoin] = useState<ActiveCoin | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (isActiveCoin(parsed)) setCoin(parsed);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveCoin = useCallback((next: ActiveCoin) => {
    setCoin(next);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const actions = useMemo(() => ({ setActiveCoin }), [setActiveCoin]);

  return (
    <ActiveCoinActionsContext.Provider value={actions}>
      <ActiveCoinStateContext.Provider value={coin}>{children}</ActiveCoinStateContext.Provider>
    </ActiveCoinActionsContext.Provider>
  );
}

export function useActiveCoin(): ActiveCoin | null {
  const coin = useContext(ActiveCoinStateContext);
  if (coin === undefined) throw new Error('useActiveCoin must be used inside ActiveCoinProvider');
  return coin;
}

export function useSetActiveCoin(): ActiveCoinActions['setActiveCoin'] {
  const actions = useContext(ActiveCoinActionsContext);
  if (!actions) throw new Error('useSetActiveCoin must be used inside ActiveCoinProvider');
  return actions.setActiveCoin;
}
