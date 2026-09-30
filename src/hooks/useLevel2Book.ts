import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { Level2Socket, type Level2Status } from '@/lib/kucoin/level2';
import type { Level2Snapshot } from '@/lib/kucoin/orderbook';

export type Level2BookState = {
  snapshot: Level2Snapshot | null;
  status: Level2Status;
};

/**
 * Owns the Level 2 connection for one pair and hands the UI the latest merged snapshot. The
 * socket is keyed on `symbol` alone, so it is torn down and rebuilt when the pair changes;
 * a stopped socket is inert, and the identity check below means a frame from the outgoing
 * connection can never be written into the incoming pair's book.
 */
export function useLevel2Book(symbol: string): Level2BookState {
  const [snapshot, setSnapshot] = useState<Level2Snapshot | null>(null);
  const [status, setStatus] = useState<Level2Status>('connecting');
  const activeSocketRef = useRef<Level2Socket | null>(null);

  // Reset during render so a symbol switch never renders the previous pair's depth.
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  if (symbol !== activeSymbol) {
    setActiveSymbol(symbol);
    setSnapshot(null);
    setStatus('connecting');
  }

  useEffect(() => {
    if (!symbol) return;
    const socket = new Level2Socket(symbol, {
      onSnapshot: (next) => {
        if (activeSocketRef.current !== socket) return;
        setSnapshot(next);
      },
      onStatus: (next) => {
        if (activeSocketRef.current !== socket) return;
        setStatus(next);
      },
    });
    activeSocketRef.current = socket;
    socket.start();

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') socket.start();
      else socket.stop();
    });

    return () => {
      if (activeSocketRef.current === socket) activeSocketRef.current = null;
      socket.stop();
      subscription.remove();
    };
  }, [symbol]);

  return { snapshot, status };
}
