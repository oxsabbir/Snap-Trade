import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'account:balances-visible';

type BalanceVisibilityContextValue = {
  balancesVisible: boolean;
  setBalancesVisible: (visible: boolean) => void;
};

const BalanceVisibilityContext = createContext<BalanceVisibilityContextValue | undefined>(undefined);

export function BalanceVisibilityProvider({ children }: { children: ReactNode }) {
  const [balancesVisible, setVisible] = useState(false);
  const changedByUser = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled || changedByUser.current) return;
        if (stored === 'true' || stored === 'false') setVisible(stored === 'true');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setBalancesVisible = useCallback((visible: boolean) => {
    changedByUser.current = true;
    setVisible(visible);
    void AsyncStorage.setItem(STORAGE_KEY, String(visible)).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ balancesVisible, setBalancesVisible }),
    [balancesVisible, setBalancesVisible],
  );

  return <BalanceVisibilityContext.Provider value={value}>{children}</BalanceVisibilityContext.Provider>;
}

export function useBalanceVisibility(): BalanceVisibilityContextValue {
  const context = useContext(BalanceVisibilityContext);
  if (!context) throw new Error('useBalanceVisibility must be used inside BalanceVisibilityProvider');
  return context;
}
