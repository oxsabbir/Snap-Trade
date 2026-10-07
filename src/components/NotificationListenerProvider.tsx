import { router } from 'expo-router';
import { useNotificationListener } from '@/hooks/useNotificationListener';
import { checkForSignal, type XNotification } from '@/lib/signalDetection';
import { fetchSymbols } from '@/lib/kucoin/market';
import { useSetActiveCoin } from '@/state/activeCoin';
import { useSignalSource } from '@/hooks/useSignalSource';

export function NotificationListenerProvider({ children }: { children: React.ReactNode }) {
  const setActiveCoin = useSetActiveCoin();
  const { isEnabled, isLoading } = useSignalSource();

  // Initialize notification listener at app startup - only for X/Twitter app
  useNotificationListener(
    async (notification: { id: number; text: string; bigText: string; postTime: number; title: string; subText: string; packageName: string }) => {
      // Only process notifications from X/Twitter app
      if (notification.packageName === 'com.twitter.android') {
        // Gate: master signal detection toggle
        if (!isEnabled || isLoading) {
          return;
        }

        const xNotif: XNotification = {
          id: notification.id,
          text: notification.text || '',
          bigText: notification.bigText || '',
          postTime: notification.postTime,
          title: notification.title || '',
          subText: notification.subText || '',
          packageName: notification.packageName,
        };

        console.log('📱 X app notification:', notification.title, notification.text?.substring(0, 50));

        const signalResult = checkForSignal(xNotif);
        if (signalResult.isSignal && signalResult.ticker) {
          console.log(
            `📱 🔔 SIGNAL DETECTED: ${signalResult.ticker} | TP1: ${signalResult.tp1} | TP count: ${signalResult.tpCount}`
          );

          // Find the full symbol (e.g., SKY-USDT) from the ticker
          const symbols = await fetchSymbols();
          const matchedSymbol = symbols.find((s) => s.baseCurrency.toUpperCase() === signalResult.ticker?.toUpperCase() && s.quoteCurrency === 'USDT');
          
          if (matchedSymbol) {
            const activeCoin = {
              symbol: matchedSymbol.symbol,
              name: matchedSymbol.baseCurrency,
              decimals: 8,
            };
            
            // Set active coin - this will update the trade screen if open
            setActiveCoin(activeCoin);
            
            // Navigate to trade tab
            router.navigate('/(tabs)/trade');
            
            console.log(`📱 🚀 Navigated to trade for ${matchedSymbol.symbol}`);
          } else {
            console.log(`📱 ⚠️ Could not find USDT pair for ticker: ${signalResult.ticker}`);
          }
        } else if (signalResult.ticker) {
          console.log(
            `📱 ${signalResult.ticker} not a signal (TPs: ${signalResult.tpCount})`
          );
        }
      }
    },
    (removed: { packageName: string; id: number }) => {
      if (removed.packageName === 'com.twitter.android') {
        console.log('📱 X app notification removed:', removed.packageName);
      }
    }
  );

  return <>{children}</>;
}