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
 *  - retry delays 0, 300ms, 1s, then capped at 2s, rotating through `instanceServers` — on
 *    spot KuCoin returns a single server, so rotation is moot there, but the ladder keeps the
 *    loop fast and each sweep completion soft-invalidates the bullet so the next cycle
 *    refetches the token and resolves DNS fresh.
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

type TopicEntry = {
  handlers: Set<TopicAttachments['onMessage']>;
};

const topics = new Map<string, TopicEntry>();
const statusListeners = new Set<(status: SocketStatus) => void>();

let status: SocketStatus = 'offline';
let socket: WebSocket | null = null;
let attempt = 0;
let pingIntervalMs = 18_000;
let lastServerAt = 0;
let lastPingAt = 0;

let connectTimer: ReturnType<typeof setTimeout> | null = null;
let welcomeTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let kickTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (topics.size === 0 || reconnectTimer) return;
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
  clearConnectTimers();
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
  if (socket) return;
  if (!fromWarm && topics.size === 0) return;
  if (welcomeTimer) return;
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
  if (socket || (!fromWarm && topics.size === 0)) return;

  // One instance server per attempt; after a full sweep the bullet is soft-invalidated, so
  // the next cycle refetches the token and resolves the host through DNS again. Server
  // order effectively never varies on spot (single entry), so the sweep invalidation is the
  // carrier-path lever: it is what turns "same dead edge" into "fresh answer".
  const servers: BulletServer[] = bullet.servers;
  const server = servers[attempt % servers.length]!;
  if (attempt > 0 && attempt % servers.length === 0) {
    invalidatePublicBullet();
  }

  const dialAt = Date.now();
  socketLog('dial', `${hostOf(server.endpoint)} attempt=${attempt}`);
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

  ws.onopen = () => {
    if (socket !== ws) return;
    socketLog('open', `${hostOf(server.endpoint)} ${Date.now() - dialAt}ms`);
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
    clearConnectTimers();
    socket = null;
    socketLog('closed', `code=${event?.code ?? '-'} attempt=${attempt}`);
    // A rejected token is a provably wrong cached answer — refetch on the next dial.
    if (event?.code === 4001 || event?.code === 4002) {
      invalidatePublicBullet({ hard: true });
    }
    // A warm dial that failed with nothing subscribed stops here: nobody is waiting on the
    // wire, so a silent retry loop would only burn battery. The next subscriber's
    // registration dials again from the retained attempt count.
    if (topics.size === 0) {
      setStatus('offline');
      return;
    }
    scheduleReconnect();
  };
}

function handleFrame(raw: string, ws: WebSocket): void {
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
    ws.send(JSON.stringify({ id: Date.now(), type: 'ping' }));
    lastPingAt = Date.now();
  }, pingIntervalMs);
  // A carrier NAT drop leaves the TCP state OPEN while the route is dead: sends vanish and
  // no close event ever arrives. Anything from the server — a pong, a data frame — proves
  // the route; silence after a ping does not.
  watchdogTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
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
  clearReconnectTimer();
  clearConnectTimers();
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

function ensureConnection(): void {
  if (topics.size === 0) return;
  if (socket || reconnectTimer) return;
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
  if (socket || reconnectTimer || welcomeTimer) return;
  void connectNow(true);
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
  if (state === 'active' && topics.size > 0) onForeground();
});

Network.addNetworkStateListener(() => {
  // Debounced: toggling data on Android emits a burst of events as radios settle.
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
    entry = { handlers: new Set() };
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
      clearReconnectTimer();
      clearConnectTimers();
      if (socket) {
        const dying = socket;
        socket = null;
        dying.onopen = dying.onerror = dying.onmessage = dying.onclose = null;
        try {
          dying.close();
        } catch {
          // Parking a CONNECTING socket by dropping the reference is safe.
        }
      }
      attempt = 0;
      setStatus('offline');
      socketLog('parked');
    }
  };
}
