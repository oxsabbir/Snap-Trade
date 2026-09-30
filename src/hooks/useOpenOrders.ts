import { useCallback, useEffect, useRef, useState } from 'react';

import { request } from '@/lib/kucoin/client';
import { cancelOrder } from '@/lib/kucoin/orders';
import { describeError } from '@/lib/kucoin/errors';
import type { OrderSide } from '@/lib/kucoin/types';

export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

export type OpenOrder = {
  orderId: string;
  clientOid?: string;
  symbol: string;
  side: OrderSide;
  type: 'limit' | 'market';
  price: string;
  size: string;
  filledSize: string;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
};

export type OpenOrdersResponse = {
  items: OpenOrder[];
};

export type UseOpenOrdersState = {
  orders: OpenOrder[];
  openCount: number;
  isLoading: boolean;
  error: string | null;
  applyOrderUpdate: (message: unknown) => void;
  cancelOrder: (orderId: string) => Promise<void>;
  refresh: () => void;
};

const EMPTY_ORDERS: OpenOrder[] = [];
const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(['filled', 'cancelled']);

function normalizeOrder(raw: Record<string, unknown>): OpenOrder {
  const side = (raw.side ?? 'buy') as OrderSide;
  const isActive = raw.isActive === true || raw.isActive === 'true';
  const dealSize = Number(raw.dealSize ?? raw.filledSize ?? '0');
  const totalSize = Number(raw.size ?? '0');
  let status: OrderStatus;
  if (!isActive) {
    if (dealSize >= totalSize && totalSize > 0) status = 'filled';
    else status = 'cancelled';
  } else if (dealSize > 0 && dealSize < totalSize) {
    status = 'partially_filled';
  } else {
    status = 'open';
  }

  return {
    orderId: String(raw.orderId ?? raw.id ?? ''),
    clientOid: raw.clientOid ? String(raw.clientOid) : undefined,
    symbol: String(raw.symbol ?? ''),
    side,
    type: (raw.type ?? 'limit') as 'limit' | 'market',
    price: String(raw.price ?? '0'),
    size: String(raw.size ?? '0'),
    filledSize: String(dealSize),
    status,
    createdAt: Number(raw.createdAt ?? raw.ts ?? Date.now()),
    updatedAt: Number(raw.updatedAt ?? raw.ts ?? Date.now()),
  };
}

export function useOpenOrders(
  symbol: string,
  hideOtherPairs: boolean
): UseOpenOrdersState {
  const [orders, setOrders] = useState<OpenOrder[]>(EMPTY_ORDERS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const cancellingRef = useRef<Set<string>>(new Set());
  const pendingOptimisticRef = useRef<Map<string, OpenOrder>>(new Map());

  const fetchOrders = useCallback(async () => {
    if (!mountedRef.current) return;
    setIsLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number | boolean> = { status: 'active' };
      if (hideOtherPairs) {
        query.symbol = symbol;
      }
      const data = await request<OpenOrdersResponse>('/orders', {
        signed: true,
        query,
      });
      if (!mountedRef.current) return;
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      const normalized = items.map(normalizeOrder).filter((o) => o.orderId);
      setOrders(normalized);
    } catch (caught) {
      if (!mountedRef.current) return;
      setError(describeError(caught, 'Failed to load open orders'));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [symbol, hideOtherPairs]);

  useEffect(() => {
    mountedRef.current = true;
    // The setState calls are all behind the awaited fetch, so this is an async bootstrap rather
    // than a synchronous cascade. The rule cannot see through the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOrders();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchOrders]);

  const applyOrderUpdate = useCallback((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const msg = message as Record<string, unknown>;
    const orderId = String(msg.orderId ?? '');
    if (!orderId) return;

    const incoming = normalizeOrder(msg);
    const isTerminal = TERMINAL_STATUSES.has(incoming.status);

    setOrders((prev) => {
      const idx = prev.findIndex((o) => o.orderId === orderId);
      if (idx === -1) {
        if (!isTerminal && (hideOtherPairs ? incoming.symbol === symbol : true)) {
          return [incoming, ...prev];
        }
        return prev;
      }
      const existing = prev[idx];
      const wasTerminal = TERMINAL_STATUSES.has(existing.status);
      if (wasTerminal && !isTerminal) {
        return prev;
      }
      const merged: OpenOrder = {
        ...existing,
        ...incoming,
        filledSize: incoming.filledSize ?? existing.filledSize,
        status: incoming.status,
        updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
      };
      const next = [...prev];
      next[idx] = merged;
      return next;
    });
  }, [symbol, hideOtherPairs]);

  const cancelOrderFn = useCallback(async (orderId: string) => {
    const cancelling = cancellingRef.current;
    if (cancelling.has(orderId)) return;
    cancelling.add(orderId);

    const optimisticOrder = orders.find((o) => o.orderId === orderId);
    if (optimisticOrder) {
      pendingOptimisticRef.current.set(orderId, optimisticOrder);
      setOrders((prev) => prev.filter((o) => o.orderId !== orderId));
    }

    try {
      await cancelOrder(orderId);
    } catch (caught) {
      if (!mountedRef.current) return;
      const errMsg = caught instanceof Error ? caught.message : 'Cancel failed';
      setError(errMsg);
      const restored = pendingOptimisticRef.current.get(orderId);
      if (restored) {
        setOrders((prev) => {
          if (prev.some((o) => o.orderId === orderId)) return prev;
          return [restored, ...prev];
        });
      }
    } finally {
      cancelling.delete(orderId);
      pendingOptimisticRef.current.delete(orderId);
    }
  }, [orders]);

  const refresh = useCallback(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const openCount = orders.length;

  return {
    orders,
    openCount,
    isLoading,
    error,
    applyOrderUpdate,
    cancelOrder: cancelOrderFn,
    refresh,
  };
}