/**
 * The ONE public-market WebSocket for the whole app.
 *
 * Every public channel the app needs (order-book depth, ticker) rides a single connection
 * keyed by nothing per-screen and nothing per-symbol: screens register topic subscriptions,
 * and switching a pair only sends an `unsubscribe` for the old topic and a `subscribe` for the
 * new one — never a reconnect. The connection itself dials at module load readiness (the
 * moment the first subscriber arrives, which is app start in practice since the boot route
 * subscribes immediately) with carrier-hostile timing:
 *
 *  - dial deadline 3s: if `onopen` has not fired, the socket is closed and retried. On
 *    carrier paths a dial into a blackholed address spends its life in the SYN queue; waiting
 *    it out (10s native default) is how 25-30s connects happened.
 *  - race dial: if the first dial is still connecting after 800ms, a second dial to the same
 *    host starts in parallel — a different TCP lane, a different carrier path. Whichever opens
 *    first wins; the loser is detached and closed immediately and can never deliver a frame.
 *    Spot returns a single instanceServer, so the race is same-host on purpose: one dial
 *    landing on a blackholed path is exactly the failure it guards against.
 *  - retry delays 0, 300ms, 1s, then capped at 2s. Three consecutive failed dials discard the
 *    cached token so the next round refetches and resolves DNS fresh — the token is almost
 *    never the problem, so it is not dropped per round.
 *  - subscribe only after the server's `welcome` frame: KuCoin documents that the session is
 *    only available once welcome arrives, so topic frames are buffered until then.
 *  - heartbeat: a client ping every `pingInterval` (from the bullet, 18s on spot) and a
 *    force-close if nothing arrives from the server within 5s of a ping — a carrier NAT drop
 *    keeps the TCP state OPEN on both ends while the route is dead, so only echo traffic is
 *    proof of life.
 *
 * Status is shared: every subscriber sees the connection's state, which is what keeps the
 * dots on different screens describing the same wire.
 */
import { AppState } from 'react-native';
import * as Network from 'expo-network';

import { fetchPublicBullet, invalidatePublicBullet, wakeRadio, type BulletServer } from './bullet';
import { isTradingModeEnabled } from '@/state/tradingMode';
import { socketLog, socketLogFailure } from './socketLog';

export type SocketStatus = 'connecting' | 'live' | 'offline';

/** A routed market frame: `topic` matches the subscription, `subject` the frame kind. */
export type PublicTopicMessage = {
  topic: string;
  subject: string;
  data: unknown;
};

/**
 * The normalized ticker update consumed by `state/ticker.ts` (and its `TickerUpdate` type
 * alias below keeps the historical import path for `useLiveCandles`).
 */
export type TickerUpdate = {
  symbol: string;
  price: number;
  /** Traded base-currency volume accumulated across one throttle window. */
  size: number;
  time: number;
  bestAsk: number;
  bestBid: number;
};

export type TopicAttachments = {
  onMessage: (message: PublicTopicMessage) => void;
  onStatus?: (status: SocketStatus) => void;
};

/**
 * Milliseconds a dial may take before it is declared hung. The native layer sets OkHttp
 * connectTimeout to the same value on Android; this is the JS-side authority (iOS and other
 * runtimes have no such native hook).
 */
const CONNECT_TIMEOUT_MS = 3_000;
/** Welcome must arrive this fast after an open, or the session is treated as unusable. */
const WELCOME_TIMEOUT_MS = 5_000;
/** Nothing from the server within 5s of a client ping → the route is dead. Force-close. */
const PONG_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [0, 300, 1_000, 2_000] as const;
/** Network-state listeners fire in bursts (data ↔ VPN ↔ Wi-Fi); one reconnect per burst. */
const KICK_DEBOUNCE_MS = 250;
/**
 * A resume where the session has *proven* itself within this window skips the destructive
 * foreground redial: a quick app switch (swipe away and back) finds the TCP session almost
 * certainly alive, and replacing it costs seconds of dark time on carrier paths. A session
 * older than this window gets the full kick, because the OS may have silently killed the
 * route while backgrounded — and the immediate ping fired alongside the skip means an
 * accidentally-kept dead one is announced by the pong watchdog in ~5s, not a heartbeat slot.
 */
const RESUME_FRESH_WINDOW_MS = 20_000;
/**
 * When the first dial is still CONNECTING after this, a second dial to the same host starts
 * in parallel. Short enough to beat the 3s deadline meaningfully, long enough that the common
 * case (first dial opens fine) never pays a second connection.
 */
const RACE_DELAY_MS = 800;
/** How long a debug freeze runs before the watchdog declares the (simulated) zombie dead. */
const DEBUG_FREEZE_VERDICT_MS = 5_000;
/** Consecutive failed dials before the cached token is discarded and refetched. */
const FAILED_DIALS_BEFORE_REFETCH = 3;

type TopicEntry = {
  handlers: Set<TopicAttachments['onMessage']>;
  /**
   * Set at registration from the connection's state — `warm` when the session was already live
   * (the frame rides a reused connection), `fresh` when the registration triggered or joined a
   * dial. Consumed by the first delivered frame's log so the field can answer "did the book
   * arrive instantly because the connection was warm, or after a fresh dial?".
   */
  firstFrameOrigin?: 'warm' | 'fresh';
};

const topics = new Map<string, TopicEntry>();
const statusListeners = new Set<(status: SocketStatus) => void>();

let status: SocketStatus = 'offline';
let socket: WebSocket | null = null;
/**
 * The racing second dial. Alive only between {@link RACE_DELAY_MS} and the first open; the
 * winner is adopted into `socket` (racer) or stays `socket` (primary) and the loser is
 * detached + closed so it can never deliver a frame.
 */
let racer: WebSocket | null = null;
let attempt = 0;
/** Consecutive failed dials since the last welcome; drives the token discard rule. */
let failedDials = 0;
let pingIntervalMs = 18_000;
let lastServerAt = 0;
let lastPingAt = 0;
/**
 * True while the OS reports no reachable internet. The manager parks completely in this state —
 * no dials, no retry ladder, no heartbeats — because every attempt is guaranteed to fail, and
 * hammering a dead radio path for hours would be pure battery burn. The network listener wakes
 * the connection the moment reachability returns.
 */
let offline = false;

/**
 * Debug freeze (the tools' "simulate a dead connection"): while active, incoming frames are
 * ignored and heartbeats stop — exactly the zombie a carrier NAT expiry produces, without
 * waiting 30 minutes for one. The watchdog declares the frozen socket dead after
 * {@link DEBUG_FREEZE_VERDICT_MS} and force-closes, which also clears the flag so the reconnect
 * ladder runs normally afterwards.
 */
let debugFreezeActive = false;
let frozenAt = 0;

let connectTimer: ReturnType<typeof setTimeout> | null = null;
let welcomeTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let raceTimer: ReturnType<typeof setTimeout> | null = null;
let racerDeadline: ReturnType<typeof setTimeout> | null = null;

function setStatus(next: SocketStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener(next);
}

/** Names the endpoint host for logs without truncating tokens out of URLs by hand. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function clearConnectTimers(): void {
  if (connectTimer) clearTimeout(connectTimer);
  if (welcomeTimer) clearTimeout(welcomeTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  connectTimer = null;
  welcomeTimer = null;
  pingTimer = null;
  watchdogTimer = null;
}

function clearReconnectTimer(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

/**
 * Detaches and closes the racing dial, if one is pending. Called on every teardown path — the
 * loser of the race, or a racer whose primary already died, must never fire a callback into
 * the manager's state machine.
 */
function discardRacer(reason: string): void {
  if (raceTimer) {
    clearTimeout(raceTimer);
    raceTimer = null;
  }
  if (racerDeadline) {
    clearTimeout(racerDeadline);
    racerDeadline = null;
  }
  const losing = racer;
  racer = null;
  if (!losing) return;
  losing.onopen = losing.onerror = losing.onmessage = losing.onclose = null;
  try {
    losing.close();
  } catch {
    // A CONNECTING racer is discarded by dropping the reference.
  }
  socketLog('race:discard', reason);
}

/** Counts one failed dial toward the token-discard rule. Reset on every welcome. */
function noteDialFailure(): void {
  failedDials += 1;
  if (failedDials < FAILED_DIALS_BEFORE_REFETCH) return;
  socketLog('token:invalidate', `${FAILED_DIALS_BEFORE_REFETCH} consecutive failed dials`);
  invalidatePublicBullet();
  failedDials = 0;
}

/** The device's network kind for the dial log — mobile vs wifi, the field's first question. */
async function networkKind(): Promise<string> {
  try {
    const state = await Network.getNetworkStateAsync();
    const type = String(state.type ?? 'unknown').toLowerCase();
    if (type === 'cellular') return 'mobile';
    if (type === 'wifi') return 'wifi';
    return type;
  } catch {
    return 'unknown';
  }
}

/** Topic frames the app wants, replayed after every welcome and on every reconnect. */
function sendSubscribes(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  for (const topic of topics.keys()) {
    socket.send(
      JSON.stringify({
        id: Date.now(),
        type: 'subscribe',
        topic,
        response: true,
      })
    );
  }
}

function retryDelayMs(): number {
  const index = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
  return attempt <= 0 ? 0 : RETRY_DELAYS_MS[Math.max(index, 0)]!;
}

function scheduleReconnect(): void {
  if (topics.size === 0 || reconnectTimer || offline) return;
  attempt += 1;
  setStatus('offline');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectNow();
  }, retryDelayMs());
}

function forceClose(reason: string): void {
  const dead = socket;
  if (!dead) return;
  socketLog('close:force', reason);
  noteDialFailure();
  clearConnectTimers();
  discardRacer('force close');
  socket = null;
  // Handlers are detached first so the SDK's own close callbacks cannot double-schedule
  // a reconnect after this force path already did (via the onclose below on some runtimes).
  dead.onopen = dead.onerror = dead.onmessage = dead.onclose = null;
  try {
    dead.close();
  } catch {
    // Dropping the reference is enough for a socket that never finished connecting.
  }
  scheduleReconnect();
}

async function connectNow(fromWarm = false): Promise<void> {
  if (socket || racer) return;
  if (!fromWarm && topics.size === 0) return;
  if (welcomeTimer) return;
  if (offline) return;
  if (topics.size === 0 && reconnectTimer) {
    // Reconnects triggered by AppState/network events skip the ladder wait entirely.
    clearReconnectTimer();
  }
  setStatus('connecting');

  let bullet: Awaited<ReturnType<typeof fetchPublicBullet>>;
  try {
    bullet = await fetchPublicBullet();
  } catch (error) {
    socketLogFailure(
      'token:fetch',
      error instanceof Error ? error.message : String(error)
    );
    scheduleReconnect();
    return;
  }
  if (socket || racer || (!fromWarm && topics.size === 0)) return;

  const servers: BulletServer[] = bullet.servers;
  const server = servers[attempt % servers.length]!;
  const net = await networkKind();
  // Parked while the token fetch and the network-state read were in flight: dial nothing.
  if (offline || socket || racer || (!fromWarm && topics.size === 0)) return;

  const dialAt = Date.now();
  socketLog('dial', `${hostOf(server.endpoint)} attempt=${attempt} net=${net}`);
  const url = `${server.endpoint}?token=${encodeURIComponent(server.token)}&connectId=snaptrade&pingInterval=${server.pingInterval}`;
  const ws = new WebSocket(url);
  socket = ws;
  pingIntervalMs = server.pingInterval;
  lastServerAt = Date.now();

  // Dial deadline: no `onopen` in 3s means the handshake blackholed — retry now.
  connectTimer = setTimeout(() => {
    if (socket !== ws) return;
    socketLog('dial:timeout', `${hostOf(server.endpoint)} after ${Date.now() - dialAt}ms`);
    forceClose('open-timeout');
  }, CONNECT_TIMEOUT_MS);

  // Race dial: if the primary is still handshaking, a second dial to the same host runs in
  // parallel. The winner is whoever opens first; `promoteRacer` / the primary's `onopen`
  // resolve the race and the loser is detached before anything can deliver through it.
  raceTimer = setTimeout(() => {
    raceTimer = null;
    if (socket !== ws || ws.readyState !== WebSocket.CONNECTING) return;
    socketLog('race:start', `${hostOf(server.endpoint)} second dial after ${Date.now() - dialAt}ms`);
    startRacer(url, server.endpoint, net, dialAt);
  }, RACE_DELAY_MS);

  ws.onopen = () => {
    if (socket !== ws) return;
    discardRacer('primary opened first');
    socketLog('open', `${hostOf(server.endpoint)} ${Date.now() - dialAt}ms net=${net}`);
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    // Session is not usable until KuCoin's welcome frame; subscribing earlier races the
    // server's own readiness and the subscribe frame can be dropped.
    welcomeTimer = setTimeout(() => forceClose('welcome-timeout'), WELCOME_TIMEOUT_MS);
  };

  ws.onmessage = (event: WebSocketMessageEvent) => {
    if (socket !== ws) return;
    handleFrame(String(event.data), ws);
  };

  ws.onerror = () => {
    if (socket !== ws) return;
    socketLog('dial:error');
  };

  ws.onclose = (event: WebSocketCloseEvent) => {
    if (socket !== ws) return;
    finishDial(ws, event);
  };
}

/**
 * The second dial of the race. It either wins — replacing the still-connecting primary as the
 * manager's socket — or loses to the primary's open / its own deadline / its own close, in
 * which case it is discarded and the primary continues untouched. Handlers accept ownership by
 * either reference (`socket` after promotion, `racer` before), because promotion swaps the
 * variable the rest of the manager reads.
 */
function startRacer(url: string, endpoint: string, net: string, primaryDialAt: number): void {
  const dialAt = Date.now();
  const ws = new WebSocket(url);
  racer = ws;
  socketLog('dial', `${hostOf(endpoint)} racer net=${net}`);

  racerDeadline = setTimeout(() => {
    if (racer !== ws) return;
    socketLog('dial:racer:timeout', `${hostOf(endpoint)} after ${Date.now() - dialAt}ms`);
    discardRacer('racer open-timeout');
  }, CONNECT_TIMEOUT_MS);

  ws.onopen = () => {
    if (socket === ws || racer !== ws) return;
    // Racer won: the primary is still CONNECTING. Detach it before it can fire anything.
    const losingPrimary = socket;
    socket = null;
    if (losingPrimary) {
      losingPrimary.onopen = losingPrimary.onerror = losingPrimary.onmessage = losingPrimary.onclose = null;
      try {
        losingPrimary.close();
      } catch {
        // Dropping the reference is enough for a socket that never finished connecting.
      }
    }
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    if (racerDeadline) {
      clearTimeout(racerDeadline);
      racerDeadline = null;
    }
    racer = null;
    socket = ws;
    socketLog('open', `${hostOf(endpoint)} racer won ${Date.now() - primaryDialAt}ms net=${net}`);
    welcomeTimer = setTimeout(() => forceClose('welcome-timeout'), WELCOME_TIMEOUT_MS);
  };

  ws.onmessage = (event: WebSocketMessageEvent) => {
    if (socket !== ws && racer !== ws) return;
    handleFrame(String(event.data), ws);
  };

  ws.onerror = () => {
    if (socket !== ws && racer !== ws) return;
    socketLog('dial:racer:error');
  };

  ws.onclose = (event: WebSocketCloseEvent) => {
    // Pre-promotion close = lost the race; the primary owns the wire and continues. Log it,
    // then let finishDial's guard no-op it. Post-promotion, `socket === ws` and this is the
    // normal close path.
    if (socket !== ws && racer === ws) {
      socketLog('race:lost', `racer closed code=${event?.code ?? '-'}`);
    }
    finishDial(ws, event);
  };
}

/**
 * The normal close path, shared by the primary dial and a racer that won promotion: teardown,
 * failure counting, token rules, and reconnect scheduling. The `socket !== ws` guard makes it
 * safe to call for a socket that already lost ownership.
 */
function finishDial(ws: WebSocket, event: WebSocketCloseEvent): void {
  if (socket !== ws) return;
  clearConnectTimers();
  discardRacer('primary closed mid-race');
  socket = null;
  socketLog('closed', `code=${event?.code ?? '-'} attempt=${attempt}`);
  noteDialFailure();
  // A rejected token is a provably wrong cached answer — refetch on the next dial.
  if (event?.code === 4001 || event?.code === 4002) {
    invalidatePublicBullet();
  }
  // A warm dial that failed with nothing subscribed stops here: nobody is waiting on the
  // wire, so a silent retry loop would only burn battery. The next subscriber's
  // registration dials again from the retained attempt count.
  if (topics.size === 0) {
    setStatus('offline');
    return;
  }
  scheduleReconnect();
}

function handleFrame(raw: string, ws: WebSocket): void {
  // Debug freeze: the simulated zombie ignores everything — including updating lastServerAt,
  // so the watchdog's silence verdict runs exactly as it would on a real dead route.
  if (debugFreezeActive) return;
  lastServerAt = Date.now();
  if (raw === 'ping') {
    // The server also pings with a bare string frame; answering keeps its keepalive — and
    // any carrier idle-timeout — satisfied.
    if (ws.readyState === WebSocket.OPEN) ws.send('pong');
    return;
  }
  if (raw === 'pong') return;

  let message: {
    id?: unknown;
    type?: string;
    subject?: string;
    topic?: string;
    data?: unknown;
  };
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  switch (message.type) {
    case 'welcome':
      if (welcomeTimer) {
        clearTimeout(welcomeTimer);
        welcomeTimer = null;
      }
      socketLog('welcome', `session=${String(message.id ?? '-')}`);
      setStatus('live');
      attempt = 0;
      failedDials = 0;
      startHeartbeat(ws);
      sendSubscribes();
      return;
    case 'pong':
      return;
    case 'ack':
      socketLog('subscribed', `topic=${message.topic ?? '-'}`);
      return;
    case 'error':
      socketLogFailure('server:error', JSON.stringify(message).slice(0, 200));
      return;
    case 'message': {
      if (typeof message.topic !== 'string' || message.data === undefined) return;
      const entry = topics.get(message.topic);
      if (!entry) return;
      // First frame a topic receives: where did it come from — a connection that was already
      // live when the screen subscribed (warm), or the dial the subscription kicked off
      // (fresh)? This is the field metric for "did warmup pay?".
      if (entry.firstFrameOrigin) {
        socketLog('frame:first', `${entry.firstFrameOrigin} topic=${message.topic}`);
        delete entry.firstFrameOrigin;
      }
      const routed = { topic: message.topic, subject: message.subject ?? '', data: message.data };
      for (const handler of entry.handlers) handler(routed);
      return;
    }
  }
}

function startHeartbeat(ws: WebSocket): void {
  if (pingTimer) clearInterval(pingTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  lastPingAt = lastServerAt;
  pingTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Frozen: the simulated zombie sends nothing, so the silence is one we created.
    if (debugFreezeActive) return;
    ws.send(JSON.stringify({ id: Date.now(), type: 'ping' }));
    lastPingAt = Date.now();
  }, Math.max(pingIntervalMs / 2, 5_000));
  // A carrier NAT drop leaves the TCP state OPEN while the route is dead: sends vanish and
  // no close event ever arrives. Anything from the server — a pong, a data frame — proves
  // the route; silence after a ping does not.
  watchdogTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    // The debug freeze's verdict: ~5s of enforced silence, then the socket is declared dead
    // like a real zombie would be. The flag clears first so the reconnect ladder runs free.
    if (debugFreezeActive) {
      if (Date.now() - frozenAt > DEBUG_FREEZE_VERDICT_MS) {
        setDebugFreeze(false);
        forceClose('debug-freeze');
      }
      return;
    }
    if (lastPingAt && Date.now() - lastPingAt > PONG_TIMEOUT_MS && lastServerAt < lastPingAt) {
      forceClose('pong-timeout');
    }
  }, 1_000);
}

/**
 * Drops whatever is on the wire and dials immediately — used by the foreground and network
 * event triggers, where waiting out the retry ladder would be exactly the wrong thing. The
 * handlers are detached before closing so the close path cannot double-schedule work.
 */
function kick(): void {
  if (topics.size === 0) return;
  offline = false;
  clearReconnectTimer();
  clearConnectTimers();
  discardRacer('kick');
  const dying = socket;
  socket = null;
  if (dying) {
    dying.onopen = dying.onerror = dying.onmessage = dying.onclose = null;
    try {
      dying.close();
    } catch {
      // A CONNECTING socket is parked by dropping the reference.
    }
  }
  attempt += 1;
  setStatus('connecting');
  void wakeRadio();
  void connectNow();
}

/**
 * Drops the wire and every pending timer: the reconnect ladder, an in-flight dial, the live
 * socket, and any racer all go. Always ends in the 'offline' status — every caller parks for
 * a reason that a later event (network return, foreground, new subscriber) revives from.
 */
function parkAll(reason: string): void {
  clearReconnectTimer();
  clearConnectTimers();
  discardRacer(reason);
  const dying = socket;
  socket = null;
  if (dying) {
    dying.onopen = dying.onerror = dying.onmessage = dying.onclose = null;
    try {
      dying.close();
    } catch {
      // A CONNECTING socket is parked by dropping the reference.
    }
  }
  attempt = 0;
  setStatus('offline');
  socketLog(reason);
}

/**
 * Fully parks the manager while the device has no reachable internet: every dial and heartbeat
 * would fail, so none are attempted. The network listener is the only thing that revives the
 * connection from here — the instant data returns, the debounced kick redials. This is what
 * makes "data off after trading for the day" cost nothing instead of an endless retry loop.
 */
function parkOffline(): void {
  if (offline) return;
  offline = true;
  parkAll('parked:no-network');
}

/**
 * Parks the connection when the app goes to the background with trading mode OFF: the feed
 * has no watcher, the native keepalive is gated off (dial-time decision), so holding the
 * socket would be pure battery burn — the foreground kick redials in ~1-2s when the user
 * comes back. With trading mode ON the socket stays: that is exactly what the mode is for.
 */
function parkForBackground(): void {
  parkAll('parked:background');
}

/**
 * Re-evaluates the trading-mode gate right after the toggle changes: in the foreground the
 * keepalive is unconditional and nothing changes; in the background with the mode now off,
 * the socket parks instead of continuing to stream to nobody.
 */
export function reapplyTradingMode(): void {
  if (AppState.currentState === 'active') return;
  if (!isTradingModeEnabled() && topics.size > 0) parkForBackground();
}

/**
 * Debug tools (behind EXPO_PUBLIC_SOCKET_TOOLS): freeze the feed to simulate a zombie route
 * without waiting for a carrier NAT expiry. While frozen, frames are ignored and heartbeats
 * stop; the watchdog closes the socket after ~5s of that silence and the flag clears, so the
 * reconnect ladder proves itself right after.
 */
export function setDebugFreeze(active: boolean): void {
  debugFreezeActive = active;
  if (active) frozenAt = Date.now();
  socketLog('debug:freeze', active ? 'on — frames ignored, heartbeats stopped' : 'off');
}

export function isDebugFreezeActive(): boolean {
  return debugFreezeActive;
}

function ensureConnection(): void {
  if (topics.size === 0) return;
  if (socket || racer || reconnectTimer) return;
  if (welcomeTimer) return;
  void connectNow();
}

/**
 * Dials the shared connection at app start, before any screen has subscribed. By the time
 * the trade screen mounts, the handshake and welcome have usually already happened — or the
 * retry ladder is already cycling — so the screen's first frames arrive on a connection that
 * is practically warm instead of paying dial + welcome on open. A warm session parks with a
 * heartbeat; a subscribed screen arriving later just sends its subscribe frames.
 */
export function warmConnection(): void {
  if (socket || racer || reconnectTimer || welcomeTimer) return;
  void connectNow(true);
}

/**
 * Drops the shared connection *and* the cached dial answer, then redials immediately: the
 * reconnect button's contract is that the user believes the wire is dead for good — so the
 * endpoint resolution and the token are replaced along with it, not just re-dialled.
 */
export function reconnectPublicSocket(): void {
  if (topics.size === 0) return;
  socketLog('reconnect:manual');
  invalidatePublicBullet();
  kick();
}

// Registered at module load: the manager is a singleton by construction and its event
// sources must exist from app start, not from the first screen mount.
/**
 * On returning to the foreground: a session the server answered within {@link RESUME_FRESH_WINDOW_MS}
 * is kept and immediately pinged — proving it live right now, or handing the verdict to the pong
 * watchdog within ~5s — instead of unconditionally paying a redial for a connection that was never
 * broken. Anything older, half-open, or mid-retry gets the full kick.
 */
function onForeground(): void {
  if (topics.size === 0) return;
  if (socket && socket.readyState === WebSocket.OPEN && Date.now() - lastServerAt < RESUME_FRESH_WINDOW_MS) {
    socketLog('resume', 'session fresh — kept, probing');
    socket.send(JSON.stringify({ id: Date.now(), type: 'ping' }));
    lastPingAt = Date.now();
    return;
  }
  kick();
}

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    if (topics.size > 0) onForeground();
    return;
  }
  // Backgrounded with trading mode off: nothing is watching the feed and the native keepalive
  // gate is closed, so the socket parks. With the mode on, the socket — and the native pings
  // that keep the carrier path alive through the background — stay exactly as they are.
  if (!isTradingModeEnabled() && topics.size > 0) parkForBackground();
});

Network.addNetworkStateListener((event) => {
  // No reachable internet — data toggled off, out of coverage — parks everything: the retry
  // ladder against a dead radio is pure battery burn and every attempt is guaranteed to fail.
  // isInternetReachable is `undefined` while evaluating, which parks nothing.
  if (event.isInternetReachable === false) {
    parkOffline();
    return;
  }
  // Reachable (or re-evaluating): a burst of events as radios settle collapses to one kick.
  if (kickTimer) return;
  kickTimer = setTimeout(() => {
    kickTimer = null;
    if (topics.size > 0) kick();
  }, KICK_DEBOUNCE_MS);
});

/**
 * Registers one topic on the shared connection and returns its release. Registration refills
 * the topic frame on the next welcome; a subscribe while the session is live sends the frame
 * right away. First registration starts the connection; the last release parks it.
 */
export function subscribeTopic(
  topic: string,
  attachments: TopicAttachments
): () => void {
  let entry = topics.get(topic);
  if (!entry) {
    entry = {
      handlers: new Set(),
      // Provenance for the first frame this topic delivers: a session that was already live
      // serves the frame warm; a registration that starts the dial serves it fresh.
      firstFrameOrigin: status === 'live' ? 'warm' : 'fresh',
    };
    topics.set(topic, entry);
  }
  const target = entry;
  target.handlers.add(attachments.onMessage);
  if (attachments.onStatus) {
    const statusListener = attachments.onStatus;
    statusListeners.add(statusListener);
    // Report the connection's current state immediately so a fresh subscriber never renders
    // a stale dot for one frame.
    statusListener(status);
  }

  if (status === 'live') {
    sendSubscribes();
  } else {
    ensureConnection();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    target.handlers.delete(attachments.onMessage);
    if (attachments.onStatus) statusListeners.delete(attachments.onStatus);
    if (target.handlers.size > 0) return;
    topics.delete(topic);
    if (status === 'live' && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({ id: Date.now(), type: 'unsubscribe', topic, response: true })
      );
      socketLog('unsubscribed', topic);
    }
    if (topics.size === 0) {
      // Last listener gone — park the connection instead of streaming a market nobody watches.
      parkAll('parked');
    }
  };
}
