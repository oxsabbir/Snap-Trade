import { request } from './client';

export type Fill = {
  tradeId: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** Execution price in quote per base. */
  price: string;
  /** Executed base size. */
  size: string;
  /** Executed quote value (price * size, before fees depending on book). */
  funds: string;
  /** Fee amount. */
  fee: string;
  /** Currency fee was charged in. */
  feeCurrency: string;
  createdAt: number;
};

export type FillPage = {
  items: Fill[];
  hasMore: boolean;
  page: number;
};

export const FILLS_PAGE_SIZE = 50;

function fieldString(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFill(raw: unknown): Fill | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tradeId = fieldString(r, 'tradeId', 'id');
  const orderId = fieldString(r, 'orderId');
  const symbol = fieldString(r, 'symbol');
  const side = fieldString(r, 'side');
  const price = fieldString(r, 'price', 'dealPrice', 'averagePrice');
  const size = fieldString(r, 'size', 'dealSize', 'amount');
  const funds = fieldString(r, 'funds', 'dealFunds');
  const fee = fieldString(r, 'fee');
  const feeCurrency = fieldString(r, 'feeCurrency', 'feeCoin', 'feeUnit');
  const createdAt = r.createdAt ?? r.tradeTime ?? r.ts;
  if (!tradeId || !symbol || !side || !price || !size) return null;
  return {
    tradeId,
    orderId: orderId ?? '',
    symbol,
    side: side === 'sell' ? 'sell' : 'buy',
    price,
    size,
    funds: funds ?? '0',
    fee: fee ?? '0',
    feeCurrency: feeCurrency ?? '',
    createdAt: toNumber(createdAt, Date.now()),
  };
}

export type FillQuery = {
  page?: number;
  /** Only fills at or after this epoch-millisecond time. */
  startAt?: number;
};

export async function fetchFills(symbol: string, query: FillQuery = {}): Promise<FillPage> {
  const page = query.page ?? 1;
  const data = await request<unknown>('/fills', {
    signed: true,
    query: {
      symbol,
      pageSize: FILLS_PAGE_SIZE,
      currentPage: page,
      ...(query.startAt ? { startAt: query.startAt } : {}),
    },
  });
  const list = Array.isArray(data) ? data : (data as { items?: unknown[] } | null)?.items ?? [];
  const items = list.map(normalizeFill).filter((f): f is Fill => f !== null);
  const totalPage = (data as { totalPage?: unknown } | null)?.totalPage;
  const hasMore =
    typeof totalPage === 'number' && totalPage > 0
      ? page < totalPage
      : items.length >= FILLS_PAGE_SIZE;
  return { items, hasMore, page };
}
