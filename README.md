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
  SearchBar  QuoteTabs  PopularSearches  RecentSearches  SpotRow  AssetRow  CoinAvatar  RangeBar
  Icons  TimeframeTabs
  PriceChart             interactive chart: drag to pan, pinch to zoom, latching crosshair
  CoinDetail           shared chart view used by the Trade tab
  CoinInfoSheet        slide-up market info modal opened from the chart header
  Stat                 shared label/value tile, used by CoinInfoSheet
  ProfileCard          account header: avatar, display name, VIP level, wallet split, hide toggle
  AssetList            one row per currency, with All/Funding/Trading filter and dust toggle
  ConnectAccountForm   API key / secret / passphrase entry
src/hooks/
  useSpotMarkets.ts    list data — REST fetch, 10s poll, AppState, pull-to-refresh
  useRecentSearches.ts AsyncStorage-backed recent search history (max 8)
  useLiveCandles.ts    chart data — REST history + WebSocket live price
  useLifetimeSeries.ts lifetime line series — paged 1week walk, symbol cache, live endpoint
  useCoinInfo.ts       coin info sheet data, fetched only while the sheet is open
  useProfile.ts        local display name, AsyncStorage-backed, never transmitted
  useAccount.ts        balances — signed REST, 30s poll, connect/disconnect
src/state/
  activeCoin.tsx       selected market, AsyncStorage-persisted, split contexts
src/lib/kucoin/
  client.ts            fetch wrapper, HMAC signing, error type
  credentials.ts       SecureStore read/write/delete for the API key triple
  account.ts           signed account endpoint; re-exports the portfolio shape
  portfolio.ts         pure wallet grouping + valuation + currency roll-up, no client import
  profile.ts           /api/v2/user-info (VIP level), session-cached
  market.ts            endpoint fns, symbol/ticker join, search ranking, session caches
  candles.ts           candle endpoint, timeframe table, helpers, paged lifetime walk
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

The Account tab adds one **signed** call, `GET /api/v1/accounts`, plus a session-cached
`GET /api/v2/user-info` for the VIP badge, both described under "Account and credentials" below.

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
| One finger tap | Latch the crosshair with the OHLC/volume popup on that candle |
| One finger drag | Pan horizontally; dragging right reveals older candles |
| Two finger pinch | `span` from the finger-distance ratio (floor of 20 candles) |
| Two finger drag | `offset` from the midpoint, dragging right reveals older candles |
| Double tap | Reset to the full loaded range, right edge on the live candle |

**The crosshair latches.** A tap sets it and it survives release, so the popup stays readable
without holding a finger down. Tapping the *same* candle again dismisses it, which is the only
way back to a clean chart once one is latched — otherwise there is no way out. A drag past
`PAN_SLOP` (6px) is reclassified as navigation: the crosshair is dropped, because a drag means
"move the chart", not "inspect this".

`offset` starts at `0` and `0` means the newest candle sits on the right edge, so the chart always
opens and stays anchored to the live edge unless the user explicitly pans. A bucket rollover
refetches history at the same length, so indices do not shift under a panned viewport.

Both gestures read `event.nativeEvent.touches` from the same `PanResponder` that already handled
the crosshair, so there is still **no gesture library**. `react-native-gesture-handler` and
`react-native-reanimated` are present as expo-router dependencies, but Reanimated 4 needs a
`react-native-worklets` babel plugin and there is no `babel.config.js` in this project — a poor
trade for 100 data points. The pinch baseline is updated incrementally on every move so a long
drag cannot drift away from the fingers, and the one-finger pan baseline is captured on grant for
the same reason.

The viewport is **index-based, which is what makes it survive live ticks**: `useLiveCandles`
replaces the last candle object every 200ms, so array identity changes constantly while length
and indices stay fixed.

### Starting state

`CoinDetail` is a single instance shared by every pair, so opening a new symbol has to put it back
the way it looked on first open. That is done in two places, and the second is the one that matters.

- `CoinDetail` resets its own state during render when `symbol` changes: timeframe back to
  `DEFAULT_TIMEFRAME_KEY` (`1min`), visible count and info sheet cleared. `chartHeight` needs no
  reset — it is derived from the window, not chosen by the user.
- `PriceChart` gets `key={symbol}`, so a symbol change **remounts** it. The chart's own
  `resetKey={symbol:timeframe}` handles a timeframe change, but on its own it was not enough:
  observed on device, a symbol switch could render a broken chart while a timeframe switch — which
  changes that same key — always cleared it. Rather than track down which internal state survived
  (the price band, the latched crosshair, the pan offset and the zoom level are all candidates),
  the remount discards all of them at once. Cost is one fresh layout per symbol, which the
  `isLoading` loader was already causing anyway.

### Symbol isolation

Remounting the chart resets its viewport, but the candles and the ticker live in
`useLiveCandles`, above the chart, so that alone did nothing to stop one symbol's data from
reaching the next. Three things had to be closed:

- **A stopped socket is inert.** Closing a WebSocket is asynchronous and does not discard work
  the event loop has already dispatched, so a `trade.ticker` frame for the previous symbol could
  still be parsed after `stop()` and delivered by its pending 200ms throttle timer.
  `TickerSocket` now re-checks `stopped` in `onopen`, `onmessage`, `onerror` and the flush
  callback, and drops the un-flushed tick in `stop()`. The `onopen` guard also stops a
  `stop()` that lands mid-handshake from leaking a live ping interval onto a dead socket.
- **Only the active socket's ticks are applied.** `useLiveCandles` tracks the current socket in
  a ref and drops anything from a socket that is no longer the active one. This is keyed on
  identity rather than on the payload, because `tickRef` is refreshed in an effect and so still
  holds the previous symbol's closure for one commit — a `update.symbol` check inside
  `handleTick` would let a stale tick straight through.
- **Superseded history responses are dropped.** A symbol switch starts a second request while
  the first is still in flight, and both resolve into the same hook. Guarding on
  `mountedRef` is not enough: the effect for the new symbol sets it straight back to `true`, so
  a slow response for the old symbol passed the check and wrote its candles and ticker into the
  new view. That happened on every symbol switch, not only on rapid tapping. A generation
  counter (`src/lib/generation.ts`) invalidates outstanding requests instead.

The browse list and the search bar both render the same `SpotRow`, so this covers both paths.

### Live badge

`status` describes the socket, and the socket's lifecycle is keyed on `symbol` alone, so the
status is deliberately **not** reset alongside the candles on a series change. A timeframe switch
deliberately keeps the connection alive, and nothing would ever move the badge back off
"connecting": the effect does not re-run, and `start()` is a no-op on a live socket. A symbol
switch does reset it, because the new `TickerSocket` reports `connecting` as its first act. The
badge is rendered inside the price block, so it is hidden while a switch is in flight rather than
showing the previous symbol's state.

### Timeframe change vs symbol change

These are different events and only the chart should react to the first one.

Changing **timeframe** is a new view of the same pair. The candles are cleared so the chart
cannot flash the outgoing series, but the socket is left connected, so the header price and the
Live badge stay put and keep ticking. Clearing the ticker here as well was what made the whole
header disappear on every timeframe change.

Changing **symbol** is a different pair, so the candles *and* the ticker are cleared. The ticker
in particular must go, or the new coin gets priced in the old coin's currency for as long as the
fetch takes.

The price and the change pill are derived separately (`src/lib/quote.ts`) because they are not
available at the same time. The price comes from the socket and is valid whenever a pair is
selected, but the bucket's open only exists once history for the current series has landed — and
that gap is exactly the timeframe-change window. So the price is always shown and the change is
withheld until its bucket arrives. Reusing the outgoing bucket's open instead would report a 1m
move against a 1D open, which is not a small error.

### Default view

`DEFAULT_SPAN = 35` is the window shown on load, out of the 100 candles fetched for an ordinary
timeframe. It is a starting view, not a cap — `MIN_VISIBLE = 20` still bounds pinch-in and `count`
still bounds pinch-out, so the full 100 is always one gesture away. Double-tap reset and the
`resetKey` effect both call `setSpan(null)`, which is what returns the view to the default; the reset
deliberately does *not* go back to full range.

The `Line` tab opts out: it passes the whole series and `defaultSpan = null`, so it opens on the
entire history rather than a 35-point window of it.

Candle width is a **fraction of the slot**, not a pixel value, so the default window is what
actually makes candles readable: 100 → 35 widens bodies 2.86× (1.9px → 5.6px on a 390pt phone).
`CANDLE_BODY_RATIO` is 0.72, giving 6.5px bodies with 2.5px gaps at the default, and 2.3px at
full zoom-out. Because the ratio feeds `WIDEST_BAR_RATIO`, raising it also nudges `plotInset`
outward, so the edge clearance stays correct automatically.

Thinly traded symbols can have fewer than 35 candles. The `count` upper bound on the clamp is
what handles this — `clamp(35, min(20, count), count)` resolves to 5 when only 5 exist — so no
extra `min()` is needed around the default.

There is no candle/line mode switch. Every ordinary timeframe is a candle chart, and the line
renderer is reachable only through the `Line` tab, which shows the whole history. `ChartModeToggle`
was removed rather than hidden, so the line path has exactly one caller.

### The `Line` tab

The first tab is `Line`, not another interval. It is the **only** place a line chart renders, and it
plots the entire available history rather than a window. KuCoin has no sub-minute candles, so a
"time before 1m" tab cannot exist; the label is `Line` and the bucket is `1week`.

`fetchLineSeries` walks the endpoint backwards from now. Each page is the newest 100 candles before
an `endAt`, and the next `endAt` is the oldest row already seen, so the walk is sequential — each
page depends on the previous one. Measured against the live endpoint:

| Symbol | Pages | Points | Span |
| --- | --- | --- | --- |
| `BTC-USDT` | 5 | 466 | 8.93y (2017-10-19) |
| `DOGE-USDT` | 3 | 295 | 5.63y |
| `SOL-USDT` | 3 | 270 | 5.16y |
| `TSLAX-USDT` | 1 | 7 | 0.11y (new listing) |

So it is 1–5 requests, 140ms–1s, capped at `MAX_LINE_PAGES = 12` (1200 buckets, ~23y) which nothing
has reached. Two costs worth knowing: the walk is sequential, and a history that is an exact
multiple of 100 needs one extra request, because a full page is not short and so cannot signal the
end — BTC at 1000 buckets costs 11 requests, not 10.

The endpoint's paging is exactly contiguous, so the walk itself adds no holes or overlaps. The
**source data** is not perfectly regular though: `BTC-USDT` has no weekly candle at all for the week
of 2017-11-02, even though 1-day candles prove trading happened that week. The chart is index-spaced,
so that missing week renders as a normal step rather than a visible gap — one week in 466 points, it
is not perceptible. Time-based spacing would misreport every irregular symbol and would break the
index-based pan/pinch model the rest of the chart is built on, so it is not worth it here.

Because the walk is expensive relative to a single page, `useLifetimeSeries` caches by symbol in a
module-level map: flicking between tabs does not refetch, and a second visit to `Line` renders
instantly. `refresh` deletes the entry so it genuinely refetches. The cache-hit case is subtle — the
fetch effect returns early for a cached symbol *and* a render-phase reset empties the loaded series,
so the array has to be re-read from the map in derived state or the second visit shows an empty
chart forever (`resolveBaseSeries`, pinned by tests).

The hook owns **no socket**. `useLiveCandles` already holds one per symbol, so the ticker is passed
in and only the final point is patched — two connections to the same symbol would be the alternative.
Volume is deliberately left alone there: the ticker reports a per-trade size, so adding those to a
weekly total would be a different quantity from the REST volume and the bar would quietly disagree
with every other timeframe.

Two consequences of the tab being a lifetime view rather than an interval:

- The header change means change from the **current weekly bucket's open**, not lifetime return. On a
  multi-year chart a lifetime percentage would be a strange thing to show next to the last price.
- `PriceChart` labels years instead of clock times when the span is long, and falls back to a single
  dot when there is only one point, since a line through one point is invisible.

`PriceChart` keeps the same viewport behaviour on the `Line` view, including the crosshair.

### Plot inset

The plot area is inset from the SVG edges by `plotInset`. Without it the first and last candles are
centred exactly on `x=0` and `x=innerWidth`, so in candle mode **half of the newest candle's body is
clipped** — the one candle that matters most sits sliced against the right-hand price axis. `innerWidth`
is already `width - AXIS_WIDTH`, so there was no room to spare at the right edge.

The inset cannot just be a constant, or be added after the width is known. Bars are centred on
their slot, so the last one needs `pad >= (innerWidth - 2*pad) * R / (2n)`, where `R` is the candle
body ratio and `n` the visible span. Solving that — rather than substituting a width into a pad that
has already been applied — gives `pad >= R*innerWidth / (2*(n+R))`, which is what `plotInset`
returns, floored at 6px for breathing room. `R` is `CANDLE_BODY_RATIO` (0.72); it tracks the body
width so a wide candle cannot overflow the edge.

It depends on `n` because a symbol with only a handful of candles has far wider bars than one
zoomed to the `MIN_VISIBLE` floor, so sizing for 20 alone is not enough. For a normal 100-candle
phone chart the inset stays under 12px and the plot keeps >95% of its width.

The inset is **asymmetric**: `plotInset` gives the minimum that clears the left edge, and the right
gets that plus `RIGHT_EDGE_GAP = 10`. The newest candle is the one being read and it sits against
the price axis, so it gets more clearance than the left edge. Because the right pad is strictly
larger than the symmetric solution, both edge invariants still hold; the plot just shifts left of
centre by half the gap.

Two other places had to follow the inset, or they would now be off by it: crosshair hit-testing
(`indexAt`) and pinch/pan offsets measure against `plotWidth` rather than `innerWidth`, so a touch
in the padding clamps to the first or last candle instead of overshooting. The x-axis edge labels
no longer get clamped, because they are anchored inwards (`start`/`end`) and can sit directly under
their candle; only the middle labels are clamped, to keep a long time string inside the plot.

### Sticky Y axis

The price band is **quantised and sticky**, because a naive auto-fit re-derives `min`/`max` from
the live candle on every tick, so the whole chart rescales five times a second and visibly
"breathes" during a pump.

- `niceBand` snaps the range outward to the nearest 1/2/5 × 10ⁿ gap, so axis labels are round
  numbers instead of values like `$60,123.45678`.
- Ticks may only **widen** the band, never narrow it. The chart holds still until the price
  genuinely exits the band.
- A **refit** — a new first candle (bucket rollover) or a new visible `span` (pinch/drag) — is
  allowed to shrink it back, keyed on `` `${firstCandleTime}:${resolvedSpan}` ``.
- `setDomain` is called during render, the same derive-state-during-render pattern as `activeKey`
  and `resetKey` above. It converges in one extra pass and cannot loop, because after the write
  the candidate band always contains the data.

**The step must be derived from the data range, never from the width of the existing band.**
`(upper - lower) / GRID_LINES` is not itself a 1/2/5 number (300/4 = 75), so deriving the step
that way shifts the rounding lattice on every pass and the axis never settles. That was a real bug
during development, caught by simulation.

A flat series — every candle at the same price, which happens on thin or freshly-listed pairs —
lands exactly on the lattice and would snap to a zero-height band, at which point the scales memo
returns null and **the chart renders nothing**. `niceBand` widens that case by one gap either
side. Also caught by simulation rather than by reading the code.

## No volume sub-panel

The chart is **price only**. A volume sub-panel used to sit below the price series, splitting the
plot band and reserving a lower slice for bars; it was removed so the price series takes the whole
band and the space below the chart stays free for the ordering UI. Volume is not lost — the
crosshair popup still reports `Vol` and turnover for the candle under the finger, and
`Candle.volume`/`turnover` remain on the model and are still accumulated by the live ticker. Only
the visual panel, its axis, the volume ceiling quantisation and the band split are gone.

With one band there is no split to straddle: the crosshair's horizontal price line and the vertical
time line both span the price band.

## Live volume accuracy

The socket throttle keeps only the **newest** price in a 200ms window, so the individual trade
sizes in that window used to be dropped and adding the last one would have understated volume.
`TickerSocket` now accumulates `pendingSize` across the window and flushes the total, so
`TickerUpdate.size` means "base volume since last flush" rather than "last trade size". The live
candle adds `volume += size` and `turnover += size * price`; volume is base currency and KuCoin's
candle volume is base too, so turnover follows in quote currency.

On a bucket rollover the accumulated size is deliberately **dropped**: the rollover branch returns
before touching the candle array, and the API snapshot for the new candle already contains those
trades, so adding them would double count. `TickerUpdate` is internal and `useLiveCandles` is its
only consumer, so redefining `size` is contained.

**Candle mode rebuilds two SVG nodes per candle 5×/sec** (a wick `Line` and a body `Rect`). That is
unmeasured — no device profiling was done, so treat the frame rate as unknown rather than assumed
fine. Line mode is unaffected, being a single `<Path>`. `react-native-svg` diffs by key so the
nodes are reconciled rather than recreated. Removing the volume panel cut one bar per candle from
that count; profiling the remaining candle path is still the obvious next step.

## Performance notes

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

Ticks update the last candle's `close`/`high`/`low` and accumulated `volume`/`turnover` in place,
so the chart, the crosshair popup and the header price all move together. When a tick
lands in a new period bucket, the hook refetches history to pick up the new candle. The socket is
torn down on background and restarted on foreground.

Two details that matter: ticks are **throttled to 200ms** in the socket before hitting
React state (BTC ticks ~10x/sec and re-rendering a 100-candle SVG chart that often is wasted
work), and the socket effect is keyed on `symbol` **only** — history fetching is a separate
effect keyed on the timeframe, so switching 1m→1D refetches candles without tearing down and
re-authenticating the connection. `tickRef` keeps the socket's `onTick` stable across that
refetch.

## Change % window

The header price pill is the change over the **currently forming candle's open**, i.e. the period
the selected timeframe label actually refers to. It used to be measured against `candles[0].open`,
the oldest of the 100 loaded bars, which meant a 1H tab displayed roughly four days of change
next to a live 1-hour price.

The trade-off: the pill now **resets to 0.00% at every bucket rollover** and climbs from there, so
on 1H it visibly restarts each hour. That is correct period behaviour, but it is jumpy in a way a
24h change is not. If it feels wrong in the hand, a 24h ticker field is the fix.

The Trade screen shows the chart and its controls only — the Open/High/Low/Close and
Volume/Turnover grid that used to sit underneath is gone, since it duplicated what the crosshair
popup already says about the candle you are pointing at. `CoinDetail` therefore only needs the
last candle, not a pass over all 100, which also removed an O(n) volume/turnover sum that had
been re-running on every one of the 5 ticks per second.

The chart sits at a **standard height** rather than filling whatever space is left, matching the
other trading apps and leaving the space below it for the ordering UI. `standardChartHeight` in
`src/theme/index.ts` takes 26.6% of the window height, subtracts a flat `CHART_HEIGHT_REDUCTION`
of 40px, and clamps the result to 170–198: floored so a short device cannot squeeze the candles
into a sliver, capped so a tall one cannot stretch them past a standard reading height. The order
view claimed the space below the chart with two full-height columns, so the chart's share came down
30% from its original 38% and 40px comes off flat on top of that; a negative reduction adds height
instead, which is the same knob in the other direction. The reduction is a single constant because
the clamps are kept in step with it — the floor and the cap are the reduced ones, so a device on the
floor, in the middle of the range and on the cap all move by the same amount. Lowering only the ratio
would leave every capped device untouched, and lowering only the clamps would leave every device
inside the range untouched; both look like the change did nothing on some screen.
`useStableChartHeight` wraps it so the height survives the soft keyboard: on Android focusing an
input resizes the window, and a height-only change would otherwise collapse the chart. It
recomputes on a **width** change instead, which is what rotation and split screen produce. A
`belowChart` view with `flex: 1` claims the remainder, so the ordering UI can move into it without
revisiting the chart's sizing. `PriceChart` measures its own width and takes its height as a prop,
so nothing here depends on a parent layout callback.

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

## Account profile card

The Account tab opens on `ProfileCard`: a flat card — `colors.surface`, hairline border and a
short accent bar across the top edge — carrying an initials avatar, the display name, a VIP
pill, the portfolio total, a Funding/Trading split and a sync footer.

**There is no gradient here, deliberately.** An earlier revision drew the background with
`react-native-svg` using `StyleSheet.absoluteFill` plus percentage `width`/`height`, which is
unreliable on both platforms, and it faded to `colors.surface` at one end so the card read as
flat even when it rendered. The whole app uses flat surfaces with hairline borders, so a flat
card matches it and drops the failure mode. `adjustsFontSizeToFit` on the total and the wallet
amounts keeps long figures from clipping without a second layout pass.

**KuCoin has no username.** There is no nickname, UID or profile endpoint anywhere in its
public or private REST API — `/api/v1/profile`, `/user`, `/account`, `/nickname` are all 404.
The real identity signal available is `GET /api/v2/user-info`, which returns VIP `level` and
sub-account counts. That badge is genuine server data; the *name* is not, so it is a local
device-only label in `useProfile` (AsyncStorage, never transmitted) with `My KuCoin` as its
fallback. Tap the name to rename it inline. Do not present the local name as if KuCoin
returned it.

`user-info` is called **once per session and cached** in `profile.ts`: it costs weight 20 in the
Management pool, far too much to spend on the 30s balance poll, and VIP level only moves when
the user changes it. It is also **not awaited** by the balance fetch and fails soft — a key
without access to it still reads balances, so it must never block or clear a working
connection. The badge simply disappears.

Note the `/api/v2` path: `client.ts` only prefixes `/api/v1` when the path is relative
(`client.ts:68`), so absolute paths pass through and get signed correctly. `API_VERSION` is
only ever the `KC-API-KEY-VERSION` *header* value and never affects the URL.

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
  per `(currency, type)` pair, so a coin can appear two or three times. `buildPortfolio` groups
  them into the **Funding** (`main`) and **Trading** (`trade` + `trade_hf`) wallets and keys the
  map on wallet *and* currency, so the per-wallet totals can never be conflated. Margin is
  excluded on purpose — those balances can be borrowed funds, so counting them would overstate
  net worth. `trade_hf` is the HF cross-margin *trading* wallet and is your own collateral, so it
  is kept under Trading.
- **The UI lists `holdings`, not `assets`.** Rendering `assets` directly put a near-identical row
  on screen for every wallet a coin sat in, which read as duplicated balances. `buildHoldings`
  rolls the per-wallet rows into one entry per currency and keeps each wallet's portion in a
  `funding` / `trading` slice, so the split is still visible on the row without duplicating it.
  Both shapes are kept: `assets` for wallet maths, `holdings` for display.
- **Most rows have zero balance.** KuCoin returns an account for every currency it knows, which
  is hundreds of rows of `"0"`. They are dropped in `buildPortfolio`.
- **Valuation is best-effort.** Direct `XXX-USDT` pair first, then `XXX-BTC × BTC-USDT` for the
  long tail, then 0. USDT itself has no pair, so it is pinned to 1. A `price` of 0 renders as
  `—`, meaning "unpriceable", not "worth nothing". `unpricedCount` is counted per *currency*, not
  per asset row — a coin unpriceable in both wallets is one thing the user needs to know about,
  not two. Unpriceable holdings are always shown, and survive the dust filter, because a zero
  value there means "unknown", not "worthless".

### Asset list controls

`AssetList` owns two pieces of view state, both local and reset on remount:

- **All / Funding / Trading.** The default *All* view shows one row per currency at its combined
  balance, with a two-tone bar and an inline `1.0 funding · 0.5 trading` breakdown when a coin
  sits in both wallets. Picking a wallet narrows the list to just that currency's slice *and*
  shows that slice's balance and value — the totals never silently stay combined while the list
  is filtered, which would misrepresent the position.
- **Hide < $1.** A toggle for leftover dust. It filters on the *currently scoped* value, so a
  coin with a large funding balance and a $0.30 trading remainder stays visible in *All* and is
  correctly hidden in *Trading*. The header count switches to `N of M` so it is never unclear
  why rows are missing.

Totals deliberately do not repeat below the card: the profile card already carries the grand
total and both wallet subtotals, so the list header shows only a holding count.

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
- The account display name is a local label, not a KuCoin identity — the API exposes no username.
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
