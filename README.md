# kucoin

A KuCoin **spot markets** app. Three tabs: a searchable, filterable list of every trading
pair, a per-pair chart with live streaming prices, and a read-only account view with balances.

Dark theme, no orders. Market data is public; balances use the user's own read-only API key.

## Stack

| | |
|---|---|
| Expo SDK | `~57.0.25` |
| React Native | `0.86.3` |
| React | `19.2.3` |
| TypeScript | `~6.0.3`, `strict: true` |
| Router | `expo-router` `~57.0.23`, typed routes enabled |
| Crypto | `@noble/hashes` `^2.4.0` — HMAC-SHA256 signing in pure JS |
| Storage | `expo-secure-store` for credentials, AsyncStorage for preferences |
| Native dirs | none — Continuous Native Generation, never hand-edit `ios/`/`android/` |

The KuCoin key is **entered at runtime and stored in the device keystore**. Nothing secret is
read from `.env` or baked into the bundle — see "Account and credentials" below.

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
app.config.ts          merges app.json + scheme + typedRoutes. No secrets.
app.json               static Expo config (name, icon, dark UI, plugins)
src/app/               ROUTES — every file here is a screen
  _layout.tsx          SafeAreaProvider + ActiveCoinProvider + Stack
  (tabs)/_layout.tsx   Tabs navigator — Home / Trade / Account
  (tabs)/index.tsx     Home: markets list, search, favorites, recent searches
  (tabs)/trade.tsx     Trade: chart for the currently selected coin
  (tabs)/account.tsx   Account: connect form, total value, asset list
src/components/        presentational only, no data fetching
  SearchBar  QuoteTabs  PopularSearches  RecentSearches  SpotRow  AssetRow
  CoinAvatar  RangeBar  Icons  TimeframeTabs  ChartModeToggle  PriceChart
  CoinDetail           shared chart view used by the Trade tab
  ConnectAccountForm   API key / secret / passphrase entry
src/hooks/
  useSpotMarkets.ts    list data — REST fetch, 10s poll, AppState, pull-to-refresh
  useRecentSearches.ts AsyncStorage-backed recent search history (max 8)
  useLiveCandles.ts    chart data — REST history + WebSocket live price
  useAccount.ts        balances — signed REST, 30s poll, connect/disconnect
src/state/
  activeCoin.tsx       selected market, AsyncStorage-persisted, split contexts
src/lib/kucoin/
  client.ts            fetch wrapper, HMAC signing, error type
  credentials.ts       SecureStore read/write/delete for the API key triple
  account.ts           signed account endpoint, USDT valuation, portfolio shape
  market.ts            endpoint fns, symbol/ticker join, search ranking
  candles.ts           candle endpoint, timeframe table, helpers
  socket.ts            TickerSocket — public WS feed, ping, backoff reconnect
  types.ts             wire types + the joined SpotMarket shape
src/theme/index.ts     colors / spacing / radius, all `as const`
src/utils/format.ts    price, percent, amount, compact volume, hue hashing
```

Import alias `@/*` → `./src/*`. Use it; do not write relative paths that climb out of `src/`.

## Data flow

Three **public** KuCoin endpoints, no credentials required:

| Call | Endpoint | Cadence |
|---|---|---|
| `fetchSymbols` | `GET /api/v1/symbols` | once per app session |
| `fetchCurrencies` | `GET /api/v1/currencies` | once per app session |
| `fetchAllTickers` | `GET /api/v1/market/allTickers` | every 10s on Home, 30s on Account |

The Account tab adds one **signed** call, `GET /api/v1/accounts`, described under
"Account and credentials" below.

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

Favorites live in `useState` in `(tabs)/index.tsx` and are **lost on reload**. Recent searches,
the active-coin selection and API credentials *do* persist — the first two in AsyncStorage, the
credentials in SecureStore. Persisting favorites the same way is the obvious next step.

## Account and credentials

Balances live behind KuCoin's **private** API, which requires HMAC-SHA256 signed requests.
The signing itself is fine to do on-device; the only thing that must never be shipped is the
**secret**. So the key is entered at runtime and kept in the OS keystore:

- `ConnectAccountForm` collects API Key / Secret / Passphrase.
- `credentials.ts` stores them with `expo-secure-store` — iOS Keychain, Android
  EncryptedSharedPreferences. Never AsyncStorage, which is plain text on disk.
- `client.ts` reads them at request time and signs `timestamp + method + path + query + body`.
  The passphrase is HMAC'd with the secret, per KuCoin's spec.
- `useAccount` calls `GET /api/v1/accounts` and `GET /api/v1/market/allTickers` together,
  then values each holding in USDT.

Signing details that are easy to get wrong:

- **API key version must match the key.** `client.ts` sends `KC-API-KEY-VERSION: 3`, which is
  what newly-created keys are. A v2 key would fail; if you ever add one, make the version
  configurable rather than guessing.
- **`KC-API-PASSPHRASE` is not the raw passphrase.** It is `base64(HMAC-SHA256(secret, passphrase))`.
  Sending the plaintext is a common bug.
- **Balance rows are per account type, not per currency.** `GET /api/v1/accounts` returns a row
  per `(currency, type)` pair, so a coin can appear two or three times. `buildPortfolio` merges
  them and filters to `main` / `trade` / `trade_hf`. Margin is excluded on purpose — those
  balances can be borrowed funds, so counting them would overstate net worth.
- **Most rows have zero balance.** KuCoin returns an account for every currency it knows, which
  is hundreds of rows of `"0"`. They are dropped in `buildPortfolio`.
- **Valuation is best-effort.** Direct `XXX-USDT` pair first, then `XXX-BTC × BTC-USDT` for the
  long tail, then 0. USDT itself has no pair, so it is pinned to 1. A `price` of 0 renders as
  `—`, meaning "unpriceable", not "worth nothing".

`connect()` verifies before committing: it saves, tries one fetch, and on failure clears the
key and rethrows so the form shows the error inline rather than dropping you on the error card.

The Account tab is read-only. The key needs the **General** permission and nothing else —
leave Spot Trading and Withdrawal **off**. Even if this device were compromised, a
General-only key cannot move funds. IP whitelisting is not usable here: mobile carrier IPs
change.

### Why there is no backend

A signing proxy is the right call if you ever distribute this. For a single-user app it is
infrastructure with no payoff: it holds the same secret, adds a deploy target, and buys
nothing. KuCoin's own OAuth login exists but is restricted to approved brokers (you email them
your IP list and they issue a `client_id`), so it is not a self-serve option.

`.env.example` is kept only as a note for a future backend; **the app does not read it**.

## Known gaps

- No tests, no test runner, no CI.
- The Account tab is read-only and single-key. No multi-account, no order entry, no
  deposits/withdrawals.
- No 24h portfolio change. Total value is a spot snapshot; it would need a cost-basis or
  historical equity series to show a percentage.
- The Account tab polls every 30s. KuCoin has a private WebSocket `/account/balance` topic for
  real-time pushes; it needs a private token from `POST /api/v1/bullet-private`, which is
  signed. Natural next step if the polling feels stale.
- No pin/zoom on the chart. It renders the full 100-candle window with a crosshair only.
- The markets list is still on 10s REST polling. If you want the list live too, the topic is
  `/market/ticker:all`, but at 996 symbols that is a firehose — filter server-side or
  reconsider whether the list needs it.
