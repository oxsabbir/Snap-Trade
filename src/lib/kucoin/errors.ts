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
  // `400100` is deliberately absent: it is overloaded ("Parameter Error", insufficient balance, or
  // an order that cannot be cancelled), so its copy has to come from the message body, below.
  '102421': 'Insufficient balance for this order.',
  '200004': 'Insufficient balance for this order.',
  '102435': 'Order size is below the minimum for this pair.',
  '102426': 'This order was already submitted.',
  '200001': 'Trading is suspended for this pair.',
  '230005': 'KuCoin is busy. Try again in a moment.',
};

/**
 * Codes that mean more than one thing, distinguished only by the `msg` KuCoin returns alongside
 * them. Matched before the code table so a `400100` that is really "order already gone" is not
 * reported to the user as a balance problem.
 */
const MESSAGE_PATTERNS: { pattern: RegExp; message: string }[] = [
  {
    pattern: /order_not_exist_or_not_allow_to_cancel|not allow(ed)? to be cancel/i,
    message: 'This order is no longer open.',
  },
  { pattern: /account\.available\.amount|insufficient balance/i, message: 'Insufficient balance for this order.' },
  { pattern: /below the minimum|minimum (order )?(amount|size)/i, message: 'Order size is below the minimum for this pair.' },
];

/**
 * True when a cancel failed because the order is already gone (filled or cancelled elsewhere),
 * rather than because the request itself was rejected. Callers use this to retire the row instead
 * of showing an error the user cannot act on.
 */
export function isOrderGoneError(error: unknown): boolean {
  return error instanceof KuCoinApiError && MESSAGE_PATTERNS[0]!.pattern.test(error.message);
}

export function describeError(error: unknown, fallback = 'Request failed.'): string {
  if (error instanceof KuCoinApiError) {
    if (error.status === 401) return MESSAGES['401000']!;
    for (const { pattern, message } of MESSAGE_PATTERNS) {
      if (pattern.test(error.message)) return message;
    }
    return MESSAGES[error.code] ?? `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : fallback;
}
