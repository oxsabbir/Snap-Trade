import { request } from './client';
import type { KuCoinAccount, PortfolioAsset, Ticker } from './types';

/** Spot wallets. Margin is excluded on purpose: those balances can be borrowed funds. */
const SPOT_ACCOUNT_TYPES = new Set(['main', 'trade', 'trade_hf']);

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchAccounts(): Promise<KuCoinAccount[]> {
  return request<KuCoinAccount[]>('/accounts', { signed: true });
}

/** Currencies that are worth ~1 USD but have no `XXX-USDT` pair to price them from. */
const PEGGED_TO_USD = new Set(['USDT']);

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

export function buildPortfolio(accounts: KuCoinAccount[], tickers: Ticker[]): PortfolioAsset[] {
  const prices = buildPriceIndex(tickers);
  const merged = new Map<string, PortfolioAsset>();

  for (const account of accounts) {
    if (!SPOT_ACCOUNT_TYPES.has(account.type)) continue;
    const balance = toNumber(account.balance);
    if (balance <= 0) continue;

    const existing = merged.get(account.currency);
    merged.set(account.currency, {
      currency: account.currency,
      balance: (existing?.balance ?? 0) + balance,
      available: (existing?.available ?? 0) + toNumber(account.available),
      holds: (existing?.holds ?? 0) + toNumber(account.holds),
      price: 0,
      value: 0,
    });
  }

  const assets: PortfolioAsset[] = [];
  for (const asset of merged.values()) {
    const price = unitPrice(asset.currency, prices);
    assets.push({ ...asset, price, value: asset.balance * price });
  }

  assets.sort((a, b) => b.value - a.value || a.currency.localeCompare(b.currency));
  return assets;
}

export function totalValue(assets: PortfolioAsset[]): number {
  let sum = 0;
  for (const asset of assets) sum += asset.value;
  return sum;
}
