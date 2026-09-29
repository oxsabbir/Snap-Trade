import { request } from './client';
import type { KuCoinAccount } from './types';

export async function fetchAccounts(): Promise<KuCoinAccount[]> {
  return request<KuCoinAccount[]>('/accounts', { signed: true });
}

export { buildPortfolio } from './portfolio';
export type { Portfolio, WalletSummary } from './portfolio';
