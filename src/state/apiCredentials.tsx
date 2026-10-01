import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { validateCredentials } from '@/lib/kucoin/account';
import {
  clearCredentials,
  getCachedCredentials,
  loadCredentials,
  saveCredentials,
} from '@/lib/kucoin/credentials';
import type { KuCoinCredentials } from '@/lib/kucoin/types';
import { clearAccountInfoCache } from '@/lib/kucoin/profile';
import { restartPrivateFeed } from '@/state/privateFeed';

export type OnboardingEntry = 'welcome' | 'setup';

type ApiCredentialsContextValue = {
  isLoading: boolean;
  isConnected: boolean;
  apiKey: string | null;
  onboardingEntry: OnboardingEntry;
  connect: (credentials: KuCoinCredentials) => Promise<void>;
  activateConnectedAccount: () => void;
  disconnect: (entry?: OnboardingEntry) => Promise<void>;
};

const ApiCredentialsContext = createContext<ApiCredentialsContextValue | null>(null);

export function ApiCredentialsProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [onboardingEntry, setOnboardingEntry] = useState<OnboardingEntry>('welcome');

  useEffect(() => {
    let cancelled = false;
    void loadCredentials().then((credentials) => {
      if (cancelled) return;
      setApiKey(credentials?.apiKey ?? null);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (credentials: KuCoinCredentials) => {
    const normalized = {
      apiKey: credentials.apiKey.trim(),
      apiSecret: credentials.apiSecret.trim(),
      apiPassphrase: credentials.apiPassphrase.trim(),
    };
    await validateCredentials(normalized);
    await saveCredentials(normalized);
    clearAccountInfoCache();
    restartPrivateFeed();
  }, []);

  const activateConnectedAccount = useCallback(() => {
    setApiKey(getCachedCredentials()?.apiKey ?? null);
  }, []);

  const disconnect = useCallback(async (entry: OnboardingEntry = 'welcome') => {
    await clearCredentials();
    clearAccountInfoCache();
    restartPrivateFeed();
    setOnboardingEntry(entry);
    setApiKey(null);
  }, []);

  const value = useMemo(
    () => ({
      isLoading,
      isConnected: apiKey !== null,
      apiKey,
      onboardingEntry,
      connect,
      activateConnectedAccount,
      disconnect,
    }),
    [
      isLoading,
      apiKey,
      onboardingEntry,
      connect,
      activateConnectedAccount,
      disconnect,
    ],
  );

  return (
    <ApiCredentialsContext.Provider value={value}>
      {children}
    </ApiCredentialsContext.Provider>
  );
}

export function useApiCredentials(): ApiCredentialsContextValue {
  const context = useContext(ApiCredentialsContext);
  if (!context) {
    throw new Error('useApiCredentials must be used inside ApiCredentialsProvider');
  }
  return context;
}