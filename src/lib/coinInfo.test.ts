/**
 * Unit tests for the CoinPaprika lookup rules behind the info sheet's About section.
 *
 * Offline like the other suites — no network. They pin down symbol resolution (exact match, ties to
 * the highest market cap, unranked coins last) and the description cleanup (tag flattening, the
 * trailing source line, whitespace).
 *
 *   bun src/lib/coinInfo.test.ts
 */
import { cleanDescription, normalizeCoinMarket, pickCurrencyId } from './coinInfo';

const tests: { name: string; run: () => void }[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

function fail(message: string): never {
  throw new Error(message);
}
function eq(actual: unknown, expected: unknown): void {
  if (actual !== expected) fail(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- pickCurrencyId ---------------------------------------------------------------------------

test('matches the symbol exactly and case-insensitively', () => {
  const id = pickCurrencyId(
    [
      { id: 'btc-bitcoin', symbol: 'BTC', rank: 1 },
      { id: 'wbtc', symbol: 'WBTC', rank: 30 },
    ],
    'btc'
  );
  eq(id, 'btc-bitcoin');
});

test('ignores coins whose symbol merely contains the query', () => {
  const id = pickCurrencyId(
    [
      { id: 'bitget-wrapped-btc', symbol: 'BGBTC', rank: 290 },
      { id: 'strkbtc', symbol: 'STRKBTC', rank: 1366 },
    ],
    'BTC'
  );
  eq(id, null);
});

test('breaks ties toward the highest market cap', () => {
  const id = pickCurrencyId(
    [
      { id: 'low', symbol: 'ABC', rank: 900 },
      { id: 'high', symbol: 'ABC', rank: 12 },
    ],
    'ABC'
  );
  eq(id, 'high');
});

test('sorts unranked coins (rank 0) behind ranked ones', () => {
  const id = pickCurrencyId(
    [
      { id: 'unranked', symbol: 'ABC', rank: 0 },
      { id: 'ranked', symbol: 'ABC', rank: 800 },
    ],
    'ABC'
  );
  eq(id, 'ranked');
});

test('falls back to an unranked coin when it is the only match', () => {
  const id = pickCurrencyId([{ id: 'only', symbol: 'ABC', rank: 0 }], 'ABC');
  eq(id, 'only');
});

test('skips matches that carry no id', () => {
  const id = pickCurrencyId([{ symbol: 'ABC', rank: 5 }], 'ABC');
  eq(id, null);
});

test('returns null for no match or an empty query', () => {
  eq(pickCurrencyId([{ id: 'btc-bitcoin', symbol: 'BTC', rank: 1 }], 'IR'), null);
  eq(pickCurrencyId([{ id: 'btc-bitcoin', symbol: 'BTC', rank: 1 }], '   '), null);
});

// --- cleanDescription -------------------------------------------------------------------------

test('strips the trailing CoinPaprika source line', () => {
  eq(cleanDescription('Bitcoin is a currency. Source: CoinPaprika.com'), 'Bitcoin is a currency.');
});

test('removes HTML markup and collapses whitespace', () => {
  eq(cleanDescription('Bitcoin  is <b>digital</b>\n   money.'), 'Bitcoin is digital money.');
});

test('returns an empty string for missing text', () => {
  eq(cleanDescription(undefined), '');
  eq(cleanDescription(''), '');
  eq(cleanDescription('   '), '');
});

// --- normalizeCoinMarket ----------------------------------------------------------------------

test('maps the ticker quote and supply fields into USD figures', () => {
  const market = normalizeCoinMarket(
    {
      rank: 1,
      circulating_supply: 19_500_000,
      total_supply: 21_000_000,
      max_supply: 21_000_000,
      quotes: {
        USD: { price: 65_000, market_cap: 1_267_500_000_000, volume_24h: 32_000_000_000, percent_change_24h: -1.25 },
      },
    },
    'btc-bitcoin'
  );
  eq(market.rank, 1);
  eq(market.marketCap, 1_267_500_000_000);
  eq(market.volume24h, 32_000_000_000);
  eq(market.change24h, -1.25);
  eq(market.circulatingSupply, 19_500_000);
  eq(market.totalSupply, 21_000_000);
  eq(market.maxSupply, 21_000_000);
  eq(market.url, 'https://coinpaprika.com/coin/btc-bitcoin/');
});

test('leaves fields CoinPaprika did not report as null', () => {
  const market = normalizeCoinMarket({ quotes: { USD: { market_cap: 5 } } }, 'x');
  eq(market.marketCap, 5);
  eq(market.rank, null);
  eq(market.volume24h, null);
  eq(market.change24h, null);
  eq(market.circulatingSupply, null);
  eq(market.maxSupply, null);
});

test('treats a missing USD quote as no figures rather than zero', () => {
  const market = normalizeCoinMarket({ rank: 42, total_supply: 1000 }, 'x');
  eq(market.marketCap, null);
  eq(market.volume24h, null);
  eq(market.totalSupply, 1000);
});

// --- runner -----------------------------------------------------------------------------------

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}: ${(error as Error).message}`);
  }
}

if (failures > 0) throw new Error(`${failures} of ${tests.length} checks failed`);
console.log(`${tests.length} checks passed`);
