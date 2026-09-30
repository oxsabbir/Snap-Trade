/**
 * Spot limit-order placement.
 *
 * KuCoin runs two spot books and each is funded by its own wallet:
 *
 *   - `trade_hf` / `POST /api/v1/hf/orders` — the high-frequency book. A key needs the
 *     `Spot` permission and the funds must sit in the `trade_hf` account.
 *   - `trade` / `POST /api/v1/orders` — the classic book, funded from the `trade` account.
 *
 * Both accept the same limit-order shape, so the only difference is the path. The caller
 * chooses the wallet from the detected balance; see `orderRules` for the pre-flight checks and
 * `errors` for turning a rejection into copy. The `/test` variants validate an order without
 * entering the matching engine, which is the only safe way to exercise placement end to end.
 */
import { request } from './client';
import type { OrderSide } from './types';

/**
 * Routes every submission through `/orders/test` instead of `/orders`, which validates the
 * signature, parameters and rules without entering the matching engine. Flip it with
 * `EXPO_PUBLIC_KUCOIN_TEST_MODE=true` to exercise the whole flow with no funds at risk.
 */
export const TEST_MODE = process.env.EXPO_PUBLIC_KUCOIN_TEST_MODE === 'true';

/** The two spot wallets an order can draw from. Matches KuCoin's account `type` values. */
export type SpotOrderWallet = 'trade' | 'trade_hf';

export type LimitOrderParams = {
  /** Unique per submission; reuse triggers `102426`. */
  clientOid: string;
  side: OrderSide;
  symbol: string;
  price: string;
  size: string;
};

export type PlacedOrder = {
  orderId: string;
  clientOid?: string;
};

export type PlaceLimitOrderOptions = {
  /** Which spot wallet funds the order. Defaults to the classic `trade` book. */
  wallet?: SpotOrderWallet;
  /** Dry run through `/test`. Defaults to `TEST_MODE`. */
  test?: boolean;
};

const CLIENT_OID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generates a one-time idempotency key. KuCoin caps `clientOid` at 40 characters; the docs'
 * own examples are 24-character alphanumerics, which is what this produces.
 */
export function createClientOid(): string {
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    out += CLIENT_OID_ALPHABET[Math.floor(Math.random() * CLIENT_OID_ALPHABET.length)]!;
  }
  return out;
}

/** The full (already `/api/v1`-prefixed) path for a wallet, optionally the dry-run variant. */
export function limitOrderPath(wallet: SpotOrderWallet, test = false): string {
  const base = wallet === 'trade_hf' ? '/api/v1/hf/orders' : '/api/v1/orders';
  return test ? `${base}/test` : base;
}

export function buildLimitOrderBody(params: LimitOrderParams): Record<string, unknown> {
  return {
    clientOid: params.clientOid,
    side: params.side,
    symbol: params.symbol,
    type: 'limit',
    price: params.price,
    size: params.size,
  };
}

export async function placeLimitOrder(
  params: LimitOrderParams,
  { wallet = 'trade', test = TEST_MODE }: PlaceLimitOrderOptions = {}
): Promise<PlacedOrder> {
  return request<PlacedOrder>(limitOrderPath(wallet, test), {
    method: 'POST',
    signed: true,
    body: buildLimitOrderBody(params),
  });
}

export type CancelOrderOptions = {
  /** Which spot wallet the order was placed from. Defaults to the classic `trade` book. */
  wallet?: SpotOrderWallet;
  /**
   * Required for the HF book, which will not cancel without it: `DELETE /hf/orders/{id}` takes
   * `?symbol=`, because that book can hold orders on the same id's symbol across accounts. The
   * classic book ignores it.
   */
  symbol?: string;
};

export async function cancelOrder(
  orderId: string,
  { wallet = 'trade', symbol }: CancelOrderOptions = {}
): Promise<void> {
  const hf = wallet === 'trade_hf';
  const base = hf ? '/api/v1/hf/orders' : '/api/v1/orders';
  await request<void>(`${base}/${orderId}`, {
    method: 'DELETE',
    signed: true,
    // Omitting it is not an error for the classic book, so it is only sent where it is required.
    ...(hf && symbol ? { query: { symbol } } : {}),
  });
}

/**
 * Active orders on the high-frequency book.
 *
 * There is no account-wide listing on this book — `GET /hf/orders/active` requires a `symbol` — so
 * the symbol list is fetched first and then one request per pair that actually has something open.
 * That is what keeps a quiet account down to a single request instead of one per listed pair.
 */
export async function fetchHighFrequencyOpenOrders(symbol: string): Promise<unknown[]> {
  const data = await request<unknown>('/hf/orders/active', { signed: true, query: { symbol } });
  return asOrderList(data);
}

/** Pairs with at least one active HF order, so no per-symbol request is spent on a quiet pair. */
export async function fetchHighFrequencyOrderSymbols(): Promise<string[]> {
  const data = await request<unknown>('/hf/orders/active/symbols', { signed: true });
  const list = asOrderList(data);
  return list
    .map((entry) => (typeof entry === 'string' ? entry : ''))
    .filter((entry) => entry.includes('-'));
}

/**
 * Both order books return their list either as a bare array or wrapped in `items`, and which one
 * comes back is not consistent between them, so both shapes are accepted.
 */
function asOrderList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const items = (data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items : [];
}

/** Classic active orders, whose list is account-wide and needs no symbol. */
export async function fetchClassicOpenOrders(): Promise<unknown[]> {
  const data = await request<unknown>('/orders', {
    signed: true,
    query: { status: 'active' },
  });
  return asOrderList(data);
}
