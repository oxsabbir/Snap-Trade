import { request } from './client';
import type { KuCoinAccount, KuCoinCredentials } from './types';

/**
 * `GET /api/v1/accounts`. The optional `type` is a KuCoin account kind (`main`, `trade`,
 * `trade_hf`, `margin`), passed through so the order form can ask for the trading wallet
 * without downloading and discarding the funding balances.
 */
export async function fetchAccounts(type?: string): Promise<KuCoinAccount[]> {
  return request<KuCoinAccount[]>('/accounts', { signed: true, query: type ? { type } : undefined });
}

/** Verifies new credentials with a read-only endpoint before they are persisted. */
export async function validateCredentials(credentials: KuCoinCredentials): Promise<void> {
  await request<KuCoinAccount[]>('/accounts', { signed: true, credentials });
}

export { buildPortfolio } from './portfolio';
export type { Portfolio, WalletSummary } from './portfolio';
