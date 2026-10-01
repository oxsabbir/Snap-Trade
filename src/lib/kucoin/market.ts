import { request } from './client';
import { decimalsFromIncrement, decimalsFromPrice } from '@/utils/format';
import type {
  AllTickersResponse,
  Currency,
  MarketStats,
  SpotMarket,
  SymbolInfo,
  Ticker,
} from './types';

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `/symbols` and `/currencies` are large, change rarely, and are shared by the
 * market list, the account valuation and the coin info sheet. They are fetched
 * once per app session and replayed from memory afterwards so reopening a coin
 * never re-spends rate-limit weight.
 */
let symbolsCache: Promise<SymbolInfo[]> | null = null;
let currenciesCache: Promise<Currency[]> | null = null;

/**
 * Roughly 0.9MB of JSON between them. They no longer sit on the path to the first rows, but they
 * still have to land for pair names and exact price increments, so they get more room than the
 * default before an abort would turn into a hard failure.
 */
const REFERENCE_TIMEOUT_MS = 30_000;

export function fetchSymbols(): Promise<SymbolInfo[]> {
  if (!symbolsCache) {
    symbolsCache = request<SymbolInfo[]>('/symbols', { timeoutMs: REFERENCE_TIMEOUT_MS });
  }
  return symbolsCache;
}

export function fetchCurrencies(): Promise<Currency[]> {
  if (!currenciesCache) {
    currenciesCache = request<Currency[]>('/currencies', { timeoutMs: REFERENCE_TIMEOUT_MS });
  }
  return currenciesCache;
}

export async function fetchAllTickers(): Promise<AllTickersResponse> {
  return request<AllTickersResponse>('/market/allTickers', { timeoutMs: 30_000 });
}

/** 24h stats for a single pair, cached per symbol for the session. */
const marketStatsCache = new Map<string, Promise<MarketStats>>();

export function fetchMarketStats(symbol: string): Promise<MarketStats> {
  const cached = marketStatsCache.get(symbol);
  if (cached) return cached;
  const pending = request<MarketStats>('/market/stats', { query: { symbol } });
  marketStatsCache.set(symbol, pending);
  pending.catch(() => marketStatsCache.delete(symbol));
  return pending;
}

/** Maps a base ticker to its human name so search can match "bitcoin" as well as "BTC". */
export function buildBaseNameIndex(currencies: Currency[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const currency of currencies) {
    if (currency.currency) index.set(currency.currency, currency.fullName || currency.name || '');
  }
  return index;
}

const MARKET_FIELDS = [
  'symbol',
  'base',
  'baseName',
  'quote',
  'market',
  'priceIncrement',
  'priceDecimals',
  'last',
  'changePercent',
  'changePrice',
  'high',
  'low',
  'volume',
  'quoteVolume',
  'buy',
  'sell',
] as const satisfies readonly (keyof SpotMarket)[];

function sameMarket(a: SpotMarket, b: SpotMarket): boolean {
  for (const field of MARKET_FIELDS) {
    if (a[field] !== b[field]) return false;
  }
  return true;
}

/**
 * `previous` lets a poll reuse the objects it already handed out. Rebuilding all ~1000 rows every
 * ten seconds would give every row a fresh `market` prop, so the memoized row could never skip and
 * the whole visible window re-rendered each tick. A pair whose numbers have not moved keeps its
 * identity, and when nothing moved at all the previous array itself comes back so every downstream
 * memo short-circuits.
 */
export function joinMarkets(
  symbols: SymbolInfo[],
  tickers: Ticker[],
  baseNames: Map<string, string>,
  previous: SpotMarket[] = []
): SpotMarket[] {
  const tickerBySymbol = new Map<string, Ticker>();
  for (const ticker of tickers) tickerBySymbol.set(ticker.symbol, ticker);

  const previousBySymbol = new Map<string, SpotMarket>();
  for (const market of previous) previousBySymbol.set(market.symbol, market);

  const markets: SpotMarket[] = [];
  for (const info of symbols) {
    if (!info.enableTrading) continue;
    const ticker = tickerBySymbol.get(info.symbol);
    if (!ticker) continue;

    const next: SpotMarket = {
      symbol: info.symbol,
      base: info.baseCurrency,
      baseName: baseNames.get(info.baseCurrency) ?? info.baseCurrency,
      quote: info.quoteCurrency,
      market: info.market,
      priceIncrement: info.priceIncrement,
      priceDecimals: decimalsFromIncrement(info.priceIncrement),
      last: toNumber(ticker.last),
      changePercent: toNumber(ticker.priceChangePercent),
      changePrice: toNumber(ticker.changePrice),
      high: toNumber(ticker.high),
      low: toNumber(ticker.low),
      volume: toNumber(ticker.vol),
      quoteVolume: toNumber(ticker.volValue),
      buy: toNumber(ticker.buy),
      sell: toNumber(ticker.sell),
    };

    const prior = previousBySymbol.get(info.symbol);
    markets.push(prior && sameMarket(prior, next) ? prior : next);
  }

  return settle(markets, previous);
}

/**
 * Rows from the ticker payload on its own. Everything the list draws — price, change, volume,
 * quote — is already here, and a symbol splits into its base and quote at the dash, so the list can
 * appear after a single request instead of waiting on the two large reference payloads. Pair names
 * and the exact price increment are placeholders until `/symbols` and `/currencies` land, at which
 * point `joinMarkets` upgrades them in place.
 */
export function joinMarketsFromTickers(tickers: Ticker[], previous: SpotMarket[] = []): SpotMarket[] {
  const previousBySymbol = new Map<string, SpotMarket>();
  for (const market of previous) previousBySymbol.set(market.symbol, market);

  const markets: SpotMarket[] = [];
  for (const ticker of tickers) {
    const dash = ticker.symbol.indexOf('-');
    if (dash === -1) continue;
    const base = ticker.symbol.slice(0, dash);

    const next: SpotMarket = {
      symbol: ticker.symbol,
      base,
      baseName: base,
      quote: ticker.symbol.slice(dash + 1),
      market: '',
      priceIncrement: '',
      priceDecimals: decimalsFromPrice(ticker.last),
      last: toNumber(ticker.last),
      changePercent: toNumber(ticker.priceChangePercent),
      changePrice: toNumber(ticker.changePrice),
      high: toNumber(ticker.high),
      low: toNumber(ticker.low),
      volume: toNumber(ticker.vol),
      quoteVolume: toNumber(ticker.volValue),
      buy: toNumber(ticker.buy),
      sell: toNumber(ticker.sell),
    };

    const prior = previousBySymbol.get(ticker.symbol);
    markets.push(prior && sameMarket(prior, next) ? prior : next);
  }

  return settle(markets, previous);
}

function settle(markets: SpotMarket[], previous: SpotMarket[]): SpotMarket[] {
  if (markets.length === previous.length) {
    let unchanged = true;
    for (let index = 0; index < markets.length; index += 1) {
      if (markets[index] !== previous[index]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return previous;
  }

  return markets;
}

export async function fetchSpotMarkets(): Promise<SpotMarket[]> {
  const [symbols, currencies, allTickers] = await Promise.all([
    fetchSymbols(),
    fetchCurrencies(),
    fetchAllTickers(),
  ]);
  return joinMarkets(symbols, allTickers.ticker, buildBaseNameIndex(currencies));
}

export const QUOTE_FILTERS = ['All', 'USDT', 'USDC', 'BTC', 'ETH', 'TRX', 'KCS'] as const;

export type QuoteFilter = (typeof QUOTE_FILTERS)[number];

const NO_MATCH = Number.POSITIVE_INFINITY;

type SearchKeys = {
  base: string;
  name: string;
  quote: string;
  symbol: string;
};

/**
 * Uppercasing a pair's name is the bulk of a keystroke's work, and only the human name actually
 * arrives mixed case from the API. Caching per market object means a poll that reuses an
 * unchanged row — see `joinMarkets` — also reuses its keys, so nothing is re-cased while typing.
 * Weak keys let a retired row fall out with its row.
 */
const searchKeyCache = new WeakMap<SpotMarket, SearchKeys>();

function keysFor(market: SpotMarket): SearchKeys {
  const cached = searchKeyCache.get(market);
  if (cached) return cached;

  const keys: SearchKeys = {
    base: market.base.toUpperCase(),
    name: market.baseName.toUpperCase(),
    quote: market.quote.toUpperCase(),
    symbol: market.symbol.toUpperCase(),
  };
  searchKeyCache.set(market, keys);
  return keys;
}

/**
 * Relevance tiers, best first. Typing "btc" should surface BTC-USDT immediately and
 * put ETH-BTC below it, not leave both buried in volume order.
 */
function relevance(keys: SearchKeys, query: string): number {
  if (keys.symbol === query) return 0;
  if (keys.base === query) return 1;
  if (keys.name === query) return 2;
  if (keys.quote === query) return 3;
  if (keys.base.startsWith(query)) return 4;
  if (keys.name.startsWith(query)) return 5;
  if (keys.quote.startsWith(query)) return 6;
  if (keys.name.includes(query)) return 7;
  if (keys.symbol.includes(query)) return 8;
  return NO_MATCH;
}

export function searchMarkets(
  markets: SpotMarket[],
  quote: QuoteFilter,
  rawQuery: string
): SpotMarket[] {
  const query = rawQuery.trim().toUpperCase();
  const byQuote = quote === 'All' ? markets : markets.filter((market) => market.quote === quote);

  if (!query) return byQuote;

  // Parallel arrays of ranks instead of one `{ market, rank, volume }` object per hit: a broad
  // query such as "e" matches over half the list, and this keeps that to two flat allocations.
  const hits: SpotMarket[] = [];
  const ranks: number[] = [];
  for (const market of byQuote) {
    const rank = relevance(keysFor(market), query);
    if (rank === NO_MATCH) continue;
    hits.push(market);
    ranks.push(rank);
  }

  const order = hits.map((_, index) => index);
  order.sort((a, b) => ranks[a]! - ranks[b]! || hits[b]!.quoteVolume - hits[a]!.quoteVolume);
  return order.map((index) => hits[index]!);
}
