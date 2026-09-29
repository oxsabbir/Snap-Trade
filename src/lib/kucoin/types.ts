export type KuCoinCredentials = {
  apiKey: string | undefined;
  apiSecret: string | undefined;
  apiPassphrase: string | undefined;
};

export type SymbolInfo = {
  symbol: string;
  name: string;
  baseCurrency: string;
  quoteCurrency: string;
  feeCurrency: string;
  market: string;
  priceIncrement: string;
  baseIncrement: string;
  quoteIncrement: string;
  baseMinSize: string;
  quoteMinSize: string;
  isMarginEnabled: boolean;
  enableTrading: boolean;
};

export type Ticker = {
  symbol: string;
  symbolName: string;
  buy: string;
  sell: string;
  bestBidSize: string;
  bestAskSize: string;
  changeRate: string;
  changePrice: string;
  open: string;
  high: string;
  low: string;
  vol: string;
  volValue: string;
  last: string;
  lastSize: string;
  averagePrice: string;
  priceChange: string;
  priceChangePercent: string;
};

export type AllTickersResponse = {
  time: number;
  ticker: Ticker[];
};

export type Currency = {
  currency: string;
  name: string;
  fullName: string;
  precision: number;
  isMarginEnabled: boolean;
};

export type SpotMarket = {
  symbol: string;
  base: string;
  baseName: string;
  quote: string;
  market: string;
  priceIncrement: string;
  priceDecimals: number;
  last: number;
  changePercent: number;
  changePrice: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  buy: number;
  sell: number;
};

export type KuCoinError = {
  code: string;
  msg: string;
  /** Parsed HTTP status, absent for transport failures. */
  status?: number;
};
