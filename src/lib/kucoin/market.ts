import { request } from './client';
import { decimalsFromIncrement } from '@/utils/format';
import type {
  AllTickersResponse,
  Currency,
  SpotMarket,
  SymbolInfo,
  Ticker,
} from './types';

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchSymbols(): Promise<SymbolInfo[]> {
  return request<SymbolInfo[]>('/symbols');
}

export async function fetchCurrencies(): Promise<Currency[]> {
  return request<Currency[]>('/currencies');
}

export async function fetchAllTickers(): Promise<AllTickersResponse> {
  return request<AllTickersResponse>('/market/allTickers');
}

/** Maps a base ticker to its human name so search can match "bitcoin" as well as "BTC". */
export function buildBaseNameIndex(currencies: Currency[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const currency of currencies) {
    if (currency.currency) index.set(currency.currency, currency.fullName || currency.name || '');
  }
  return index;
}

export function joinMarkets(
  symbols: SymbolInfo[],
  tickers: Ticker[],
  baseNames: Map<string, string>
): SpotMarket[] {
  const tickerBySymbol = new Map<string, Ticker>();
  for (const ticker of tickers) tickerBySymbol.set(ticker.symbol, ticker);

  const markets: SpotMarket[] = [];
  for (const info of symbols) {
    if (!info.enableTrading) continue;
    const ticker = tickerBySymbol.get(info.symbol);
    if (!ticker) continue;

    markets.push({
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
    });
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

/**
 * Relevance tiers, best first. Typing "btc" should surface BTC-USDT immediately and
 * put ETH-BTC below it, not leave both buried in volume order.
 */
function relevance(market: SpotMarket, query: string): number {
  const name = market.baseName.toUpperCase();

  if (market.symbol === query) return 0;
  if (market.base === query) return 1;
  if (name === query) return 2;
  if (market.quote === query) return 3;
  if (market.base.startsWith(query)) return 4;
  if (name.startsWith(query)) return 5;
  if (market.quote.startsWith(query)) return 6;
  if (name.includes(query)) return 7;
  if (market.symbol.includes(query)) return 8;
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

  const scored: { market: SpotMarket; rank: number; volume: number }[] = [];
  for (const market of byQuote) {
    const rank = relevance(market, query);
    if (rank === NO_MATCH) continue;
    scored.push({ market, rank, volume: market.quoteVolume });
  }

  scored.sort((a, b) => a.rank - b.rank || b.volume - a.volume);
  return scored.map((entry) => entry.market);
}
