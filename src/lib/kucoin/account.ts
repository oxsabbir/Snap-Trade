import { request } from './client';
import type { KuCoinAccount } from './types';

/**
 * `GET /api/v1/accounts`. The optional `type` is a KuCoin account kind (`main`, `trade`,
 * `trade_hf`, `margin`), passed through so the order form can ask for the trading wallet
 * without downloading and discarding the funding balances.
 */
export async function fetchAccounts(type?: string): Promise<KuCoinAccount[]> {
  return request<KuCoinAccount[]>('/accounts', { signed: true, query: type ? { type } : undefined });
}

export { buildPortfolio } from './portfolio';
export type { Portfolio, WalletSummary } from './portfolio';
