import * as Linking from 'expo-linking';

/**
 * Normalises a deep-link route segment into a KuCoin spot symbol.
 *
 * `SKY` and `sky` become `SKY-USDT`; `sky-usdt` becomes `SKY-USDT`. Anything that is not a
 * `BASE-QUOTE` pair after normalisation is rejected so a stray URL never opens a trade screen
 * for a symbol that cannot exist.
 */
export function normalizeTradeSymbol(value: string | null | undefined): string | null {
  if (!value) return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }

  const cleaned = decoded.trim().toUpperCase();
  if (!cleaned) return null;

  const withQuote = cleaned.includes('-') ? cleaned : `${cleaned}-USDT`;
  return /^[A-Z0-9]+-[A-Z0-9]+$/.test(withQuote) ? withQuote : null;
}

/**
 * Pulls the symbol out of a `snaptrade://trade/<symbol>` link, accepting both the
 * `host=trade`, `path=<symbol>` shape and the `path=trade/<symbol>` shape that different
 * platforms hand back.
 */
export function parseTradeSignalUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let parsed: ReturnType<typeof Linking.parse>;
  try {
    parsed = Linking.parse(url);
  } catch {
    return null;
  }

  const path = (parsed.path ?? '').replace(/^\/+/, '');
  const segments = path.split('/').filter(Boolean);

  let candidate: string | undefined;
  if (parsed.hostname?.toLowerCase() === 'trade') {
    candidate = segments[0];
  } else if (segments[0]?.toLowerCase() === 'trade') {
    candidate = segments[1];
  }

  return normalizeTradeSymbol(candidate ?? null);
}
