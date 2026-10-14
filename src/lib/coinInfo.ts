/**
 * Coin descriptions come from CoinPaprika, not KuCoin: KuCoin's public REST API exposes no project
 * summary, only market data. The lookup is two keyless public requests — a symbol search to resolve
 * the ticker to CoinPaprika's id, then that coin's detail row for the prose.
 *
 * CoinPaprika's free tier asks for attribution, so the returned description carries the source name
 * and a link the sheet renders underneath the text. Every lookup is cached per base ticker for the
 * session, and a failure is evicted so a retry is a real retry rather than a replay of the error.
 */

const BASE_URL = 'https://api.coinpaprika.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export type CoinDescription = {
  /** Plain text, ready to render. Empty never escapes this module. */
  text: string;
  /** Short attribution shown under the paragraph. */
  source: string;
  /** Attribution link, opened from the sheet. */
  url: string;
};

type PaprikaCurrency = {
  id?: string;
  symbol?: string;
  rank?: number;
};

type PaprikaCoin = {
  description?: string;
};

/**
 * Search returns any coin whose name or symbol contains the query, so "BTC" also surfaces wrapped
 * and staked tickers. Matching is exact and case-insensitive, and ties go to the highest market cap
 * (`rank`), which is what someone typing a common ticker means. `rank` is 0 for unranked coins, so
 * those sort last instead of first.
 */
export function pickCurrencyId(currencies: PaprikaCurrency[], symbol: string): string | null {
  const wanted = symbol.trim().toUpperCase();
  if (!wanted) return null;

  let best: PaprikaCurrency | null = null;
  for (const currency of currencies) {
    if (!currency.id) continue;
    if ((currency.symbol ?? '').toUpperCase() !== wanted) continue;
    if (!best || rankOf(currency) < rankOf(best)) best = currency;
  }
  return best?.id ?? null;
}

function rankOf(currency: PaprikaCurrency): number {
  const rank = currency.rank ?? 0;
  return rank > 0 ? rank : Number.POSITIVE_INFINITY;
}

/**
 * CoinPaprika appends a "Source: CoinPaprika.com" line to every description. It is stripped so the
 * sheet can show its own attribution link with a real URL, and any stray markup is flattened to
 * spaces so no tags or entities leak into the paragraph.
 */
export function cleanDescription(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s*Source:\s*CoinPaprika\.com\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`CoinPaprika responded ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const descriptionCache = new Map<string, Promise<CoinDescription | null>>();

/**
 * Resolves a base ticker such as "BTC" to its project summary. Returns `null` when CoinPaprika has
 * no exact-symbol match or the matched coin carries no description, so the sheet can simply omit
 * the section rather than show an empty heading.
 */
export function fetchCoinDescription(symbol: string): Promise<CoinDescription | null> {
  const wanted = symbol.trim().toUpperCase();
  if (!wanted) return Promise.resolve(null);

  const cached = descriptionCache.get(wanted);
  if (cached) return cached;

  const pending = loadDescription(wanted);
  descriptionCache.set(wanted, pending);
  // A failed lookup must not be remembered, or the retry would replay the rejection forever. A
  // genuine "no description" resolves to null and is cached like any other result.
  pending.catch(() => {
    if (descriptionCache.get(wanted) === pending) descriptionCache.delete(wanted);
  });
  return pending;
}

async function loadDescription(symbol: string): Promise<CoinDescription | null> {
  const search = await getJson<{ currencies?: PaprikaCurrency[] }>(
    `${BASE_URL}/search?q=${encodeURIComponent(symbol)}&c=currencies&limit=15`
  );
  const id = pickCurrencyId(search.currencies ?? [], symbol);
  if (!id) return null;

  const coin = await getJson<PaprikaCoin>(`${BASE_URL}/coins/${encodeURIComponent(id)}`);
  const text = cleanDescription(coin.description);
  if (!text) return null;

  return { text, source: 'CoinPaprika', url: `https://coinpaprika.com/coin/${id}/` };
}
