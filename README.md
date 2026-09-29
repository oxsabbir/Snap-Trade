# kucoin

A KuCoin **spot markets** app. Two screens: a searchable, filterable list of every trading
pair, and a per-pair chart screen with live streaming prices.

Dark theme, no auth, no orders. Market data only.

## Stack

| | |
|---|---|
| Expo SDK | `~57.0.25` |
| React Native | `0.86.3` |
| React | `19.2.3` |
| TypeScript | `~6.0.3`, `strict: true` |
| Router | `expo-router` `~57.0.23`, typed routes enabled |
| Crypto | `@noble/hashes` `^2.4.0` |
| Native dirs | none — Continuous Native Generation, never hand-edit `ios/`/`android/` |

Expo loads `.env` automatically; every `EXPO_PUBLIC_*` / `KUCOIN_*` key is inlined into the
bundle at build time.

## Commands

```bash
npx expo start          # dev server
npx expo start --ios    # or --android / --web
npx tsc --noEmit        # typecheck
npx expo lint           # eslint
npx expo-doctor         # diagnose config/dep issues
```

Both `typecheck` and `lint` pass clean as of the last commit.

## Layout

```
app.config.ts          merges app.json + scheme + typedRoutes + extra.kucoin (secrets, see below)
app.json               static Expo config (name, icon, dark UI, plugins)
src/app/               ROUTES — every file here is a screen
  _layout.tsx          SafeAreaProvider + ActiveCoinProvider + Stack
  (tabs)/_layout.tsx   Tabs navigator — Home / Trade / Account
  (tabs)/index.tsx     Home: markets list, search, favorites, recent searches
  (tabs)/trade.tsx     Trade: chart for the currently selected coin
  (tabs)/account.tsx   Account: minimal shell, private balances not wired
src/components/        presentational only, no data fetching
  SearchBar  QuoteTabs  PopularSearches  RecentSearches  SpotRow
  CoinAvatar  RangeBar  Icons  TimeframeTabs  ChartModeToggle  PriceChart
  CoinDetail           shared chart view used by the Trade tab
src/hooks/
  useSpotMarkets.ts    list data — REST fetch, 10s poll, AppState, pull-to-refresh
  useRecentSearches.ts AsyncStorage-backed recent search history (max 8)
  useLiveCandles.ts    chart data — REST history + WebSocket live price
src/state/
  activeCoin.tsx       selected market, AsyncStorage-persisted, split contexts
src/lib/kucoin/
  client.ts            fetch wrapper, HMAC signing, error type
  market.ts            endpoint fns, symbol/ticker join, search ranking
  candles.ts           candle endpoint, timeframe table, helpers
  socket.ts            TickerSocket — public WS feed, ping, backoff reconnect
  types.ts             wire types + the joined SpotMarket shape
src/theme/index.ts     colors / spacing / radius, all `as const`
src/utils/format.ts    price, percent, compact volume, hue hashing
```

Import alias `@/*` → `./src/*`. Use it; do not write relative paths that climb out of `src/`.

## Data flow

Three **public** KuCoin endpoints, no credentials required:

| Call | Endpoint | Cadence |
|---|---|---|
| `fetchSymbols` | `GET /api/v1/symbols` | once per app session |
| `fetchCurrencies` | `GET /api/v1/currencies` | once per app session |
| `fetchAllTickers` | `GET /api/v1/market/allTickers` | every 10s |

`useSpotMarkets` caches the two slow reference sets in refs and only re-fetches tickers on
the poll. It clears both refs on pull-to-refresh so symbol changes are picked up. Polling
runs only while `AppState.currentState === 'active'`, and an `AppState` listener triggers an
immediate catch-up load on foreground. A `mountedRef` guard prevents setState after unmount.

`joinMarkets` (market.ts:37) merges the three payloads into `SpotMarket[]`, dropping any
symbol with `enableTrading === false` or no matching ticker. `priceDecimals` is derived from
the symbol's `priceIncrement` — that is the display precision, not a hardcoded constant.

`searchMarkets` (market.ts:108) ranks by tiered relevance — exact symbol > base ticker >
full name > quote > prefix matches — and breaks ties by `quoteVolume`. Typing `btc` surfaces
BTC-USDT above ETH-BTC instead of leaving both in volume order.

## Home and Trade use different transports

This is deliberate. The list does not need 100ms prices; the chart does.

**Markets list — REST polling.** `useSpotMarkets` caches the two slow reference sets in refs
and only re-fetches tickers every 10s, and only while `AppState.currentState === 'active'`.
Cheap on battery, and a list of 996 rows is not read at sub-second precision. Worst-case
staleness is roughly 2s (KuCoin snapshots `allTickers` every 2s) plus the 10s poll.

**Trade tab — WebSocket.** `useLiveCandles` fetches candle history over REST once, then
streams the live price. `TickerSocket` fetches a token from `POST /api/v1/bullet-public`,
subscribes to `/market/ticker:{symbol}`, and pings on the server's `pingInterval`. Measured
on BTC-USDT: ~9.5 messages/sec, ~105ms average interval, connection held over a 60s soak
with zero disconnects.

Ticks update the last candle's `close`/`high`/`low` in place, so the chart and the header
price move together. When a tick lands in a new period bucket, the hook refetches history to
pick up the new candle. The socket is torn down on background and restarted on foreground.

Two details that matter: ticks are **throttled to 200ms** in the socket before hitting
React state (BTC ticks ~10x/sec and re-rendering a 100-candle SVG chart that often is wasted
work), and the socket effect is keyed on `symbol` **only** — history fetching is a separate
effect keyed on the timeframe, so switching 1m→1D refetches candles without tearing down and
re-authenticating the connection. `tickRef` keeps the socket's `onTick` stable across that
refetch.

## Navigation

Three tabs under the `(tabs)` route group, which is invisible in the URL. The group is
mounted inside a root `Stack`, and the root `_layout` also owns `ActiveCoinProvider`.

Tapping a `SpotRow` writes that market to the active-coin context and then calls
`router.navigate('/(tabs)/trade')`, so the Trade tab always shows the last market you picked.
The selection is persisted to `AsyncStorage` under `trade:active-coin`, so it survives a cold
start. With nothing selected yet, Trade shows an empty state that links back to Markets.

`useActiveCoin` and `useSetActiveCoin` read from **two separate contexts** on purpose. The
markets list is ~996 memoized rows; if they subscribed to the coin state they would all
re-render on every selection. Rows subscribe only to the setter, whose identity is stable.


## KuCoin API gotchas

These have all cost time. Don't regress them.

- **Candles come newest-first.** `fetchCandles` reverses them so charts read left to right.
- **Candle timestamps are seconds, not milliseconds.** The `Ticker` type uses ms. Same
  codebase, two different units.
- **`allTickers` costs rate-limit weight 15**; `/market/candles` is cheaper. Public pool is
  2000/30s per IP, so the 10s poll is ~2% of quota — but it is per-IP, so CGNAT/carrier NAT
  means users share a bucket. The WebSocket sidesteps this entirely.
- **100 candles is a hard server cap** on `/market/candles`. `startAt`/`endAt` do not raise
  it. So 1m gives ~100 minutes and 1W gives ~2 years. The toolbar labels this honestly
  (`100 × 1m`) rather than implying it is all history. Paging back means looping on `endAt`.
- **No official SDK is used, on purpose.** `kucoin-universal-sdk` is Node-targeted (axios,
  `process.env`, transport builders) and does not bundle into Metro. The 148-line
  `client.ts` does the same job with zero dependencies. `react-native-svg` powers the chart
  for the same reason — no chart library, no Skia, no extra native module.

## Conventions worth knowing

- **No relative-path date/time.** `formatTime` uses `getHours()` (local), deliberately
  matching KuCoin display expectations.
- **Prices keep their precision.** `formatPrice` takes an explicit `decimals` from the
  symbol's increment; the adaptive fallback only applies when it's omitted. Don't hardcode 2.
- **Volume is always `quoteVolume`** (volValue), never base volume.
- `CoinAvatar` colours come from `hashToHue`, so a coin keeps one deterministic hue forever.
  There is no image loading and no icon library.
- Rows are `memo`ized (`SpotRow`, `CoinAvatar`) and the FlatList sets
  `initialNumToRender` / `maxToRenderPerBatch` / `windowSize` / `removeClippedSubviews`.
  Preserve those if you add rows.
- All colors come from `src/theme`. No inline hex outside the theme (the two rgba
  change-pill tints in `SpotRow` are the deliberate exception).
- No comments in source unless they earn their place — explain *why*, not *what*.

## State that does not persist

Favorites live in `useState` in `(tabs)/index.tsx` and are **lost on reload**. Recent searches
and the active-coin selection *do* persist, via AsyncStorage. Persisting favorites the same way
is the obvious next step.

## ⚠️ Secrets are currently compiled into the client bundle

`app.config.ts:7-11` reads `KUCOIN_API_KEY` / `KUCOIN_API_SECRET` / `KUCOIN_API_PASSPHRASE`
from the environment and places them in `extra.kucoin`. Expo inlines `extra` into the
JavaScript bundle, and `client.ts:29` reads them back at runtime via
`Constants.expoConfig.extra`. **The secret and passphrase ship inside the app.**

`client.ts` also implements full HMAC-SHA256 request signing (`KC-API-KEY`, `KC-API-SIGN`,
`KC-API-PASSPHRASE`), but nothing calls it with `signed: true` — the only screens use
public market data. So today the signing code is dead, and the credentials riding along in
the bundle protect nothing.

`.env.example` already states the rule this violates: *"Never ship a secret in a client
build — proxy through your backend."*

Before adding any signed/private endpoint:

1. Delete the `kucoin` block from `app.config.ts` and `readCredentials`/`hasCredentials`
   from `client.ts`.
2. Stand up a small backend that holds the keys in *its* env and signs there.
3. Point the app at that backend.

`/profile/apikey/new` on kucoin.com issues dev keys. The local `.env` is gitignored
(`.gitignore:34`) — keep it that way, and never commit real values.

## Known gaps

- No tests, no test runner, no CI.
- `package.json` declares `"lint"` twice (lines 31 and 33). Harmless, last one wins, but
  worth cleaning up.
- The Account tab is a shell only. Balances come from `GET /api/v1/accounts`, which needs
  the signing proxy described above — until that exists there is nothing to show, so the
  screen says so rather than inventing numbers.
- No order entry, no deposits/withdrawals — all of which need the same proxy.
- No pin/zoom on the chart. It renders the full 100-candle window with a crosshair only.
- The markets list is still on 10s REST polling. If you want the list live too, the topic is
  `/market/ticker:all`, but at 996 symbols that is a firehose — filter server-side or
  reconsider whether the list needs it.
