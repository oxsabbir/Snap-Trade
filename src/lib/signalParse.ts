/**
 * Pure parsing for `snaptrade://trade/<symbol>` links.
 *
 * Kept free of React Native (and of `expo-linking`, whose import chain reaches native modules)
 * so the rules below can be unit-tested offline — see `signalParse.test.ts`. `signalUrl.ts`
 * supplies the `Linking.parse` step and re-exports from here.
 */

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
 * A parsed `snaptrade://trade/<symbol>` link: the normalised pair plus the optional posted
 * prices a signal carries — `?entry=` for gem posts and `?tp1=` for TP posts.
 */
export type TradeSignal = {
  symbol: string;
  /** Plain decimal string exactly as the signal posted it — display-ready, never reformatted. */
  entry: string | null;
  /** TP1 from a TP-format post, kept as the posted decimal string. Null for gem posts. */
  tp1: string | null;
};

/** A posted price is carried through only if it is a plain positive decimal. */
export function sanitizeDecimal(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/**
 * Assembles a signal from the already-parsed pieces of a link, accepting both the `host=trade`,
 * `path=<symbol>` shape and the `path=trade/<symbol>` shape that different platforms hand back.
 */
export function parseSignalParts(
  hostname: string | null | undefined,
  path: string | null | undefined,
  queryParams: unknown,
): TradeSignal | null {
  const segments = (path ?? '').replace(/^\/+/, '').split('/').filter(Boolean);

  let candidate: string | undefined;
  if (hostname?.toLowerCase() === 'trade') {
    candidate = segments[0];
  } else if (segments[0]?.toLowerCase() === 'trade') {
    candidate = segments[1];
  }

  const symbol = normalizeTradeSymbol(candidate ?? null);
  if (!symbol) return null;

  const query =
    queryParams && typeof queryParams === 'object'
      ? (queryParams as Record<string, unknown>)
      : {};

  return {
    symbol,
    entry: sanitizeDecimal(query.entry),
    tp1: sanitizeDecimal(query.tp1),
  };
}
