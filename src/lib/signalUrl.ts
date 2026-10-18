import * as Linking from 'expo-linking';

import { parseSignalParts } from './signalParse';

export { normalizeTradeSymbol } from './signalParse';
export type { TradeSignal } from './signalParse';

/**
 * Parses a `snaptrade://trade/<symbol>` deep link into a signal. `Linking.parse` does the
 * URL-splitting; the pair/query rules live in `signalParse` so they can be tested without React
 * Native. Returns null for anything that is not a tradeable pair.
 */
export function parseTradeSignalUrl(
  url: string | null | undefined,
): import('./signalParse').TradeSignal | null {
  if (!url) return null;

  let parsed: ReturnType<typeof Linking.parse>;
  try {
    parsed = Linking.parse(url);
  } catch {
    return null;
  }

  return parseSignalParts(parsed.hostname, parsed.path, parsed.queryParams);
}
