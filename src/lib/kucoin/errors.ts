/**
 * Turns KuCoin error codes into copy a user can act on.
 *
 * The exchange reports almost everything as a numeric code in an otherwise terse body, and the
 * codes that matter for a signed trading request (permission off, IP whitelist, insufficient
 * balance, duplicate `clientOid`) are not self-explanatory. Centralizing the mapping keeps the
 * account screen and the order form from drifting and makes each code greppable.
 */
import { KuCoinApiError } from './client';

const MESSAGES: Record<string, string> = {
  '400003': 'Invalid API key, secret or passphrase.',
  '400004': 'Passphrase does not match this API key.',
  '401000': 'KuCoin rejected these credentials.',
  NETWORK_ERROR: 'Network unavailable. Check your connection.',
  NO_CREDENTIALS: 'No credentials found on this device.',
  '429': 'Rate limited by KuCoin. Try again in a moment.',

  // Spot order placement.
  '400200': 'This API key does not have Spot Trading permission enabled.',
  '400006': 'This API key is locked to an IP whitelist. Remove it, or this request cannot succeed.',
  '400100': 'Insufficient balance for this order.',
  '102421': 'Insufficient balance for this order.',
  '102435': 'Order size is below the minimum for this pair.',
  '102426': 'This order was already submitted.',
  '200001': 'Trading is suspended for this pair.',
  '230005': 'KuCoin is busy. Try again in a moment.',
};

export function describeError(error: unknown, fallback = 'Request failed.'): string {
  if (error instanceof KuCoinApiError) {
    if (error.status === 401) return MESSAGES['401000']!;
    return MESSAGES[error.code] ?? `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : fallback;
}
