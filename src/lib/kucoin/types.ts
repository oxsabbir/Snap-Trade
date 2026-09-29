export type KuCoinCredentials = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};

/** Raw `GET /api/v1/accounts` row. Balances are decimal strings. */
export type KuCoinAccount = {
  id: string;
  currency: string;
  type: string;
  balance: string;
  available: string;
  holds: string;
};

/** Which of the two spot wallets an asset sits in. */
export type WalletKind = 'funding' | 'trading';

/** An account row joined with its USDT valuation from the ticker feed. */
export type PortfolioAsset = {
  wallet: WalletKind;
  currency: string;
  balance: number;
  available: number;
  holds: number;
  price: number;
  value: number;
};

/** One wallet's portion of a single currency. */
export type WalletSlice = {
  balance: number;
  available: number;
  holds: number;
  value: number;
};

/**
 * One currency across every wallet, so a coin held in both appears as a single
 * row with a split instead of two near-identical rows.
 */
export type Holding = {
  currency: string;
  balance: number;
  available: number;
  holds: number;
  price: number;
  value: number;
  /** `null` when the currency is not held in that wallet. */
  funding: WalletSlice | null;
  trading: WalletSlice | null;
};

/**
 * `GET /api/v2/user-info`. KuCoin exposes no username, nickname or UID on any
 * endpoint, so this is the only real identity signal available: VIP level and
 * sub-account usage. Requires the General permission we already ask for.
 */
export type AccountInfo = {
  level: number;
  subQuantity: number;
  spotSubQuantity: number;
  marginSubQuantity: number;
  futuresSubQuantity: number;
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
  baseMaxSize: string;
  quoteMaxSize: string;
  priceLimitRate: string;
  minFunds: string;
  isMarginEnabled: boolean;
  enableTrading: boolean;
};

/**
 * Per-symbol 24h market stats from `GET /api/v1/market/stats`. Public, and unlike
 * `/market/allTickers` it is scoped to one pair and carries the fee schedule.
 * KuCoin's public REST API exposes no market cap or circulating supply.
 */
export type MarketStats = {
  time: number;
  symbol: string;
  buy: string;
  sell: string;
  changeRate: string;
  changePrice: string;
  high: string;
  low: string;
  vol: string;
  volValue: string;
  last: string;
  averagePrice: string;
  takerFeeRate: string;
  makerFeeRate: string;
  takerCoefficient: string;
  makerCoefficient: string;
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
  confirms: number;
  contractAddress: string;
  withdrawalMinSize: string;
  withdrawalMinFee: string;
  isMarginEnabled: boolean;
  isWithdrawEnabled: boolean;
  isDepositEnabled: boolean;
  isDebitEnabled: boolean;
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

/** Raw candle tuple: [time, open, close, high, low, volume, turnover]. */
export type CandleTuple = [number, string, string, string, string, string, string];

export type Candle = {
  time: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
};

export type ChartMode = 'line' | 'candle';
