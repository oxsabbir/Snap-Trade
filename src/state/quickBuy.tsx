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

const STORAGE_KEY = 'trade:quick-buy-enabled';

type QuickBuyContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

const QuickBuyContext = createContext<QuickBuyContextValue | undefined>(undefined);

export function QuickBuyProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const changedByUser = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled || changedByUser.current) return;
        if (stored === 'true' || stored === 'false') setEnabledState(stored === 'true');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    changedByUser.current = true;
    setEnabledState(next);
    void AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);

  return <QuickBuyContext.Provider value={value}>{children}</QuickBuyContext.Provider>;
}

export function useQuickBuy(): QuickBuyContextValue {
  const context = useContext(QuickBuyContext);
  if (!context) throw new Error('useQuickBuy must be used inside QuickBuyProvider');
  return context;
}
