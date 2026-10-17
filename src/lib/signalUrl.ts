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
 * A parsed `snaptrade://trade/<symbol>` link: the normalised pair plus the optional signal
 * entry price carried by gem-format posts (`?entry=0.0007306`).
 */
export type TradeSignal = {
  symbol: string;
  /** Plain decimal string exactly as the signal posted it — display-ready, never reformatted. */
  entry: string | null;
};

/** A posted price is carried through only if it is a plain positive decimal. */
function sanitizeEntry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/**
 * Pulls the symbol (and optional entry price) out of a `snaptrade://trade/<symbol>` link,
 * accepting both the `host=trade`, `path=<symbol>` shape and the `path=trade/<symbol>` shape
 * that different platforms hand back.
 */
export function parseTradeSignalUrl(url: string | null | undefined): TradeSignal | null {
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

  const symbol = normalizeTradeSymbol(candidate ?? null);
  if (!symbol) return null;

  return { symbol, entry: sanitizeEntry(parsed.queryParams?.entry) };
}
