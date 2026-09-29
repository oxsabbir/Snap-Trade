import { request } from './client';
import type { AccountInfo } from './types';

/**
 * KuCoin's private API exposes no username, nickname or UID, so there is nothing
 * to log in as. `user-info` is the closest thing to a profile: VIP level and
 * sub-account usage. It needs the General permission we already require.
 *
 * Cached for the session because the values only move when the user changes
 * their own level, and the endpoint costs weight 20 in the Management pool —
 * far too expensive to spend on the 30s balance poll.
 */
let cache: Promise<AccountInfo> | null = null;

export function fetchAccountInfo(): Promise<AccountInfo> {
  if (!cache) {
    cache = request<AccountInfo>('/api/v2/user-info', { signed: true }).catch((error: unknown) => {
      // A key without Management-level access still reads balances, so this must
      // never take the account screen down. Fail soft and let the card omit the badge.
      cache = null;
      throw error;
    });
  }
  return cache;
}

export function clearAccountInfoCache(): void {
  cache = null;
}
