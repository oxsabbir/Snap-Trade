import type { Holding, KuCoinAccount, PortfolioAsset, Ticker, WalletKind } from './types';

/**
 * KuCoin splits spot balances across several account rows. `main` is the funding
 * wallet you top up from; `trade` and `trade_hf` are the trading wallets. They are
 * kept apart because the same coin can sit in both at once and a combined figure
 * hides where the funds actually are.
 *
 * The `margin` account is excluded on purpose: those balances can be borrowed funds,
 * so counting them as your own would overstate the portfolio. `trade_hf` is the HF
 * cross-margin *trading* wallet, which is your own collateral, so it is kept.
 */
const WALLET_BY_ACCOUNT_TYPE: Record<string, WalletKind> = {
  main: 'funding',
  trade: 'trading',
  trade_hf: 'trading',
};

const WALLET_META: Record<WalletKind, { label: string; hint: string }> = {
  funding: { label: 'Funding', hint: 'Your main wallet' },
  trading: { label: 'Trading', hint: 'Funds available to trade' },
};

/** Currencies that are worth ~1 USD but have no `XXX-USDT` pair to price them from. */
const PEGGED_TO_USD = new Set(['USDT']);

export type WalletSummary = {
  kind: WalletKind;
  label: string;
  hint: string;
  assets: PortfolioAsset[];
  total: number;
  /** USD value locked in open orders or withdrawals. */
  onHold: number;
};

export type Portfolio = {
  /** Every asset across both wallets, largest first. One row per wallet *and* currency. */
  assets: PortfolioAsset[];
  /** The same money rolled up to one entry per currency. This is what the UI lists. */
  holdings: Holding[];
  funding: WalletSummary;
  trading: WalletSummary;
  total: number;
  onHold: number;
  /** Currencies with no priceable pair. They get a row but contribute nothing to the total. */
  unpricedCount: number;
};

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type PriceIndex = { usdt: Map<string, number>; btc: Map<string, number> };

function buildPriceIndex(tickers: Ticker[]): PriceIndex {
  const usdt = new Map<string, number>();
  const btc = new Map<string, number>();

  for (const ticker of tickers) {
    const [base, quote] = ticker.symbol.split('-');
    if (!base || !quote) continue;
    const price = toNumber(ticker.last);
    if (price <= 0) continue;
    if (quote === 'USDT') usdt.set(base, price);
    else if (quote === 'BTC') btc.set(base, price);
  }

  for (const currency of PEGGED_TO_USD) {
    if (!usdt.has(currency)) usdt.set(currency, 1);
  }

  return { usdt, btc };
}

/**
 * USDT value of one unit. Direct USDT pair first, then via BTC for the long tail of
 * altcoins that only quote against BTC. Zero means "unpriceable", not "worth nothing".
 */
function unitPrice(currency: string, prices: PriceIndex): number {
  const direct = prices.usdt.get(currency);
  if (direct !== undefined) return direct;

  const btcPrice = prices.btc.get(currency);
  const btcUsd = prices.usdt.get('BTC');
  if (btcPrice !== undefined && btcUsd !== undefined) return btcPrice * btcUsd;

  return 0;
}

function emptyWallet(kind: WalletKind): WalletSummary {
  return {
    kind,
    label: WALLET_META[kind].label,
    hint: WALLET_META[kind].hint,
    assets: [],
    total: 0,
    onHold: 0,
  };
}

function emptyPortfolio(): Portfolio {
  return {
    assets: [],
    holdings: [],
    funding: emptyWallet('funding'),
    trading: emptyWallet('trading'),
    total: 0,
    onHold: 0,
    unpricedCount: 0,
  };
}

/**
 * Rolls per-wallet asset rows up into one entry per currency, keeping each wallet's
 * portion as a slice. Rendering a coin held in both wallets as a single row is what
 * stops the account list from looking duplicated; the slices stay attached so the UI
 * can still show where the money actually is.
 */
export function buildHoldings(assets: PortfolioAsset[]): Holding[] {
  const byCurrency = new Map<string, Holding>();

  for (const asset of assets) {
    let holding = byCurrency.get(asset.currency);

    if (!holding) {
      holding = {
        currency: asset.currency,
        balance: 0,
        available: 0,
        holds: 0,
        // Price is derived per currency, so every slice of it carries the same figure.
        price: asset.price,
        value: 0,
        funding: null,
        trading: null,
      };
      byCurrency.set(asset.currency, holding);
    }

    holding.balance += asset.balance;
    holding.available += asset.available;
    holding.holds += asset.holds;
    holding.value += asset.value;

    if (asset.wallet === 'funding') holding.funding = assetSlice(asset);
    else holding.trading = assetSlice(asset);
  }

  const holdings = [...byCurrency.values()];
  const byValue = (a: Holding, b: Holding) => b.value - a.value || a.currency.localeCompare(b.currency);
  holdings.sort(byValue);

  return holdings;
}

function assetSlice(asset: PortfolioAsset) {
  return {
    balance: asset.balance,
    available: asset.available,
    holds: asset.holds,
    value: asset.value,
  };
}

export function buildPortfolio(accounts: KuCoinAccount[], tickers: Ticker[]): Portfolio {
  const prices = buildPriceIndex(tickers);
  // Keyed by wallet *and* currency, so a coin held in both wallets stays two rows
  // rather than being silently merged into one misleading balance.
  const merged = new Map<string, PortfolioAsset>();

  for (const account of accounts) {
    const wallet = WALLET_BY_ACCOUNT_TYPE[account.type];
    if (!wallet) continue;
    const balance = toNumber(account.balance);
    if (balance <= 0) continue;

    const key = `${wallet}:${account.currency}`;
    const existing = merged.get(key);
    merged.set(key, {
      wallet,
      currency: account.currency,
      balance: (existing?.balance ?? 0) + balance,
      available: (existing?.available ?? 0) + toNumber(account.available),
      holds: (existing?.holds ?? 0) + toNumber(account.holds),
      price: 0,
      value: 0,
    });
  }

  const portfolio = emptyPortfolio();
  if (merged.size === 0) return portfolio;

  for (const raw of merged.values()) {
    const price = unitPrice(raw.currency, prices);
    const asset: PortfolioAsset = { ...raw, price, value: raw.balance * price };

    const wallet = asset.wallet === 'funding' ? portfolio.funding : portfolio.trading;
    wallet.assets.push(asset);
    wallet.total += asset.value;
    wallet.onHold += asset.holds * asset.price;
    portfolio.assets.push(asset);
    portfolio.total += asset.value;
    portfolio.onHold += asset.holds * asset.price;
  }

  const byValue = (a: PortfolioAsset, b: PortfolioAsset) =>
    b.value - a.value || a.currency.localeCompare(b.currency);
  portfolio.assets.sort(byValue);
  portfolio.funding.assets.sort(byValue);
  portfolio.trading.assets.sort(byValue);

  portfolio.holdings = buildHoldings(portfolio.assets);
  // Counted per currency, not per asset row: a coin unpriceable in both wallets is
  // still one coin the user needs to know about.
  portfolio.unpricedCount = portfolio.holdings.reduce(
    (count, holding) => (holding.price <= 0 ? count + 1 : count),
    0
  );

  return portfolio;
}
