# kucoin

A KuCoin **spot markets** app. Three tabs: a searchable, filterable list of every trading
pair, a per-pair chart with live streaming prices, pinch-to-zoom and a coin info panel, and a
read-only account view with balances.

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
  CoinInfoSheet        slide-up market info modal opened from the chart header
  Stat                 shared label/value tile used by CoinDetail and CoinInfoSheet
  ConnectAccountForm   API key / secret / passphrase entry
src/hooks/
  useSpotMarkets.ts    list data — REST fetch, 10s poll, AppState, pull-to-refresh
  useRecentSearches.ts AsyncStorage-backed recent search history (max 8)
  useLiveCandles.ts    chart data — REST history + WebSocket live price
  useCoinInfo.ts       coin info sheet data, fetched only while the sheet is open
  useAccount.ts        balances — signed REST, 30s poll, connect/disconnect
src/state/
  activeCoin.tsx       selected market, AsyncStorage-persisted, split contexts
src/lib/kucoin/
  client.ts            fetch wrapper, HMAC signing, error type
  credentials.ts       SecureStore read/write/delete for the API key triple
  account.ts           signed account endpoint, USDT valuation, portfolio shape
  market.ts            endpoint fns, symbol/ticker join, search ranking, session caches
  candles.ts           candle endpoint, timeframe table, helpers
  socket.ts            TickerSocket — public WS feed, ping, backoff reconnect
  types.ts             wire types + the joined SpotMarket shape
src/theme/index.ts     colors / spacing / radius, all `as const`
src/utils/format.ts    price, percent, amount, compact volume, hue hashing
```

Import alias `@/*` → `./src/*`. Use it; do not write relative paths that climb out of `src/`.

## Data flow

Four **public** KuCoin endpoints, no credentials required:

| Call | Endpoint | Cadence |
|---|---|---|
| `fetchSymbols` | `GET /api/v1/symbols` | once per app session |
| `fetchCurrencies` | `GET /api/v1/currencies` | once per app session |
| `fetchAllTickers` | `GET /api/v1/market/allTickers` | every 10s on Home, 30s on Account |
| `fetchMarketStats` | `GET /api/v1/market/stats?symbol=X` | once per symbol, on sheet open |

The Account tab adds one **signed** call, `GET /api/v1/accounts`, described under
"Account and credentials" below.

`market.ts` memoises the first two plus per-symbol stats at module scope for the whole session,
so the market list, the account valuation and the coin info sheet share one copy each and
reopening a coin spends no extra rate-limit weight.

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

## Chart gestures

`PriceChart` is a hand-rolled viewport over the loaded candle array, not a scale transform.
Two numbers describe it: `span` (how many candles are visible, `null` = fit all) and `offset`
(candles hidden to the right, `0` = pinned to the live edge). The visible window is clamped to
`span ∈ [20, count]` and `offset ∈ [0, count - span]`, and the derived `start` index feeds the
geometry memo, the Y auto-fit range, the candle body width and the axis labels. The default
state reproduces the old full-range chart exactly, so the gesture work was purely additive.

| Gesture | Result |
| --- | --- |
| One finger drag | Crosshair inspection, unchanged |
| Two finger pinch | `span` from the finger-distance ratio (floor of 20 candles) |
| Two finger drag | `offset` from the midpoint, dragging right reveals older candles |
| Double tap | Reset to the full loaded range |

Both gestures read `event.nativeEvent.touches` from the same `PanResponder` that already handled
the crosshair, so there is still **no gesture library**. `react-native-gesture-handler` and
`react-native-reanimated` are present as expo-router dependencies, but Reanimated 4 needs a
`react-native-worklets` babel plugin and there is no `babel.config.js` in this project — a poor
trade for 100 data points. The pinch baseline is updated incrementally on every move so a long
drag cannot drift away from the fingers.

The viewport is **index-based, which is what makes it survive live ticks**: `useLiveCandles`
replaces the last candle object every 200ms, so array identity changes constantly while length
and indices stay fixed. `CoinDetail` passes `resetKey={symbol:timeframe}` so a timeframe switch
resets to full range during render, matching the reset pattern in `useLiveCandles`.

**Performance is a non-issue at this data size.** Candle mode renders 2 SVG nodes per candle and
line mode renders a single `<Path>`, so the chart is capped at ~200 nodes. Panning holds that
count, zooming in *reduces* it, and zoom-out is clamped at the full range — the gesture path can
never do more work than the pre-gesture chart. Two deliberate details: the crosshair readout is
suppressed while a second finger is down, because RN `Text` relayout is the expensive part
relative to SVG nodes; and `onVisibleRangeChange` dedupes by value so the toolbar's visible-count
label never re-renders `CoinDetail` on a gesture frame.

## Coin info

The `ⓘ` button beside the symbol opens `CoinInfoSheet`, a `transparent` slide-up `Modal` with
tap-outside dismiss. It is built on **`GET /api/v1/market/stats?symbol=X`**, a public endpoint
scoped to a single pair — unlike `/market/allTickers` it also carries the fee schedule. Combined
with the `/symbols` and `/currencies` rows the app already loads, the sheet shows 24h high/low/
volume/quote-volume/change, average price, best bid/ask with spread in bps, maker and taker fee
rates, the trading limits (price increment, price limit rate, min funds, base and quote size
ranges), and the base asset's precision, confirmations, contract address, withdrawal minimum and
fee, plus deposit/withdrawal/margin/debit flags.

`useCoinInfo` fetches **only while the sheet is open and never polls**, so it cannot drift the
rate-limit budget, and `market.ts` memoises `/symbols`, `/currencies` and per-symbol stats for
the session. That cache also removes pre-existing waste: the market list and the account
valuation each used to re-fetch the same two large reference sets independently.

**KuCoin's public REST API has no market cap, circulating supply, or coin rank**, so the sheet
omits them rather than inventing numbers. A third-party source would be required to add those.

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
  for the same reason — no chart library, no Skia, no extra native module. Chart zoom and pan
  likewise use the built-in `PanResponder` rather than `react-native-gesture-handler` or
  Reanimated, so neither needed to be added as a direct dependency.

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
- Zooming out re-spaces the ~100 candles already loaded, it does not page in older history. The
  server caps `/market/candles` at 100 per call, so deeper history needs an `endAt` loop and its
  own loading state. Until then the 100-candle window is the whole visible world.
- Chart gestures are unverified on a real device: the pinch threshold, double-tap window and the
  sheet's drag-to-dismiss all need on-hardware feel checks.
- The Account tab polls every 30s. KuCoin has a private WebSocket `/account/balance` topic for
  real-time pushes; it needs a private token from `POST /api/v1/bullet-private`, which is
  signed. Natural next step if the polling feels stale.
- The markets list is still on 10s REST polling. If you want the list live too, the topic is
  `/market/ticker:all`, but at 996 symbols that is a firehose — filter server-side or
  reconsider whether the list needs it.
