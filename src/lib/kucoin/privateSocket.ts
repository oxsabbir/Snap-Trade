/**
 * KuCoin's private spot WebSocket: order changes and balance changes for the connected account.
 *
 * This is a second socket rather than an extra topic on the public manager because the two need
 * different tokens. `bullet-public` serves market data to anyone, including signed-out browsing,
 * and a public token is rejected on private topics. `bullet-private` needs credentials, so the
 * connection has to be built separately and must stay silent when nothing is connected.
 *
 * Both private topics carry absolute values — an order frame has the order's current size and
 * filled size, a balance frame has the account's current available and held amounts. So a message
 * is a complete answer, not a nudge to re-fetch.
 *
 * Topic shapes, from KuCoin's Classic spot docs:
 *   /spotMarket/tradeOrdersV2  subject "orderChange"      privateChannel "true"
 *   /account/balance           subject "account.balance"   privateChannel "true"
 *
 * The connection timing mirrors `publicSocket.ts` (same carrier-hostile reasoning — these are the
 * timings that turn 25-30s GP connects into seconds and zombies into fast redials):
 *
 *  - dial deadline 3s: no `onopen` by then and the handshake blackholed a dead route — close, and
 *    fall through the ladder (0, 300ms, 1s, then a 2s cap) immediately instead of waiting out the
 *    10s native timeout per dead IP.
 *  - subscribe only after the server's `welcome` frame: the session is not usable until it
 *    arrives, and subscribe frames sent earlier can be dropped — on private topics a dropped
 *    subscribe is the silent kind of failure: no fills, no errors, just a stale list.
 *  - heartbeat: a client ping on the token's cadence, and a force-close if nothing arrives from
 *    the server within 5s of a ping. A carrier NAT drop leaves TCP OPEN on both ends while the
 *    route is dead — only echo traffic proves the route, so a zombie session is closed and
 *    redialled instead of silently starving the order list for one reconcile interval.
 *  - the token is refetched when the exchange rejects it (close 4001/4002) or after a full
 *    dial sweep, subject to the same short cooldown the public token uses so a fast-failing
 *    ladder cannot hammer the signed endpoint.
 */
import { request } from '@/lib/kucoin/client';
import { getCachedCredentials } from '@/lib/kucoin/credentials';
import { socketLog, socketLogFailure } from '@/lib/kucoin/socketLog';

const BULLET_TTL_MS = 60 * 60 * 1000; // tokens last 24h; re-fetch hourly to stay well inside it
/**
 * After a *soft* invalidation (failed dial sweep) the refetch is held off this long so the
 * retry ladder cannot hammer the signed `bullet-private` endpoint while the path itself is down.
 * Hard invalidations (rejected token, close 4001/4002) always refetch immediately.
 */
const BULLET_REFETCH_COOLDOWN_MS = 5_000;

const ORDER_TOPIC = '/spotMarket/tradeOrdersV2';
const BALANCE_TOPIC = '/account/balance';

/**
 * Milliseconds a dial may take before it is declared hung. The Android native layer sets OkHttp's
 * WebSocket connectTimeout to the same value; this is the JS-side authority on every runtime.
 */
const CONNECT_TIMEOUT_MS = 3_000;
/** Welcome must arrive this fast after an open, or the session is treated as unusable. */
const WELCOME_TIMEOUT_MS = 5_000;
/** Nothing from the server within 5s of a client ping → the route is dead. Force-close. */
const PONG_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [0, 300, 1_000, 2_000] as const;

type BulletServer = {
  token: string;
  endpoint: string;
  pingInterval: number;
  pingTimeout: number;
};

type BulletResponse = {
  token: string;
  instanceServers: {
    endpoint: string;
    pingInterval: number;
    pingTimeout: number;
  }[];
};

export type PrivateOrderMessage = { symbol: string; orderId: string; [key: string]: unknown };

export type PrivateBalanceMessage = {
  /** e.g. "trade.hold", "trade.setted", "main.transfer" — identifies which book moved. */
  relationEvent?: string;
  currency?: string;
  available?: string;
  hold?: string;
  total?: string;
  [key: string]: unknown;
};

export type PrivateSocketStatus = 'connecting' | 'live' | 'offline';

type Listener = {
  onOrder: (message: PrivateOrderMessage) => void;
  onBalance: (message: PrivateBalanceMessage) => void;
  onStatus: (status: PrivateSocketStatus) => void;
};

type CachedBullet = BulletServer & { expiresAt: number };

let cachedBullet: CachedBullet | null = null;
let bulletPromise: Promise<BulletServer> | null = null;

/**
 * Monotonic message id. Two frames sent in the same millisecond — the pair of subscriptions, or a
 * subscription that lands on the same tick as a ping — would otherwise share a `Date.now()` id, and
 * the exchange uses the id to match its responses.
 */
let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `${Date.now()}-${messageCounter}`;
}

/** Names the endpoint host for logs. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/**
 * Asks for a signed connection token. Unlike the public one this cannot be cached across a
 * signed-out session, so it is only ever fetched once a caller confirms credentials exist.
 */
export async function fetchPrivateBullet(): Promise<BulletServer> {
  const now = Date.now();
  if (cachedBullet && cachedBullet.expiresAt > now) return cachedBullet;
  if (bulletPromise) return bulletPromise;

  socketLog('token:private:fetch:begin');
  const startedAt = now;
  bulletPromise = (async () => {
    try {
      // `request` already handles the timeout and the signed headers, and unwraps `data`.
      const payload = await request<BulletResponse>('/api/v1/bullet-private', {
        method: 'POST',
        signed: true,
      });
      const server = payload.instanceServers?.[0];
      if (!payload.token || !server?.endpoint) {
        throw new Error('Private token request returned no instance servers.');
      }
      const data: CachedBullet = {
        token: payload.token,
        endpoint: server.endpoint,
        pingInterval: server.pingInterval,
        pingTimeout: server.pingTimeout,
        expiresAt: now + BULLET_TTL_MS,
      };
      cachedBullet = data;
      socketLog('token:private:fetch:done', `${Date.now() - startedAt}ms, ttl 1h`);
      return data;
    } finally {
      bulletPromise = null;
    }
  })();

  return bulletPromise;
}

/**
 * Drops the cached token. `hard` marks it provably wrong (KuCoin rejected it, close 4001/4002) and
 * refetches on the very next dial; a soft invalidation caps the cache's remaining life so the next
 * dial past the cooldown refetches without the ladder hammering the endpoint.
 */
export function invalidatePrivateBullet(options: { hard?: boolean } = {}): void {
  if (options.hard) {
    cachedBullet = null;
    socketLog('token:private:invalidate:hard');
    return;
  }
  if (!cachedBullet) return;
  cachedBullet = { ...cachedBullet, expiresAt: Math.min(cachedBullet.expiresAt, Date.now() + BULLET_REFETCH_COOLDOWN_MS) };
  socketLog('token:private:invalidate:soft');
}

/** True when an API key is available, so callers can avoid opening a socket that cannot auth. */
export async function hasCredentials(): Promise<boolean> {
  return getCachedCredentials() !== null;
}

/**
 * Streams order and balance changes for the whole account, not one symbol: KuCoin pushes both
 * topics account-wide, and filtering by symbol would drop desktop activity on other pairs.
 */
export class PrivateSocket {
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private pingIntervalMs = 18_000;
  private lastServerAt = 0;
  private lastPingAt = 0;
  private stopped = true;

  constructor(private readonly listener: Listener) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    // Handlers are detached before closing so work the event loop already dispatched — an open,
    // a message, or a close from the previous session — cannot fire after stop() returned.
    const dying = this.socket;
    this.socket = null;
    if (dying) {
      dying.onopen = dying.onerror = dying.onmessage = dying.onclose = null;
      try {
        dying.close();
      } catch {
        // A CONNECTING socket is parked by dropping the reference.
      }
    }
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.watchdogTimer = null;
    this.connectTimer = null;
    this.welcomeTimer = null;
    this.reconnectTimer = null;
  }

  private clearSessionTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.welcomeTimer) clearTimeout(this.welcomeTimer);
    this.pingTimer = null;
    this.watchdogTimer = null;
    this.connectTimer = null;
    this.welcomeTimer = null;
  }

  private subscribe(socket: WebSocket): void {
    // `privateChannel` is the string "true" on these topics, not a boolean — the docs show it
    // quoted and the exchange ignores the subscription when it is not.
    for (const topic of [ORDER_TOPIC, BALANCE_TOPIC]) {
      socket.send(
        JSON.stringify({
          id: nextMessageId(),
          type: 'subscribe',
          topic,
          response: true,
          privateChannel: 'true',
        })
      );
      socketLog('subscribed:private', topic);
    }
  }

  private forceClose(reason: string): void {
    const dead = this.socket;
    if (!dead) return;
    socketLog('close:private:force', reason);
    this.clearSessionTimers();
    this.socket = null;
    dead.onopen = dead.onerror = dead.onmessage = dead.onclose = null;
    try {
      dead.close();
    } catch {
      // A socket that never finished connecting is parked by dropping the reference.
    }
    this.scheduleReconnect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    // Without a key there is nothing to subscribe to, and retrying would spin. Stay offline and
    // let the next start() — after credentials are saved — try again.
    if (!(await hasCredentials())) {
      this.stopped = true;
      this.listener.onStatus('offline');
      return;
    }

    this.listener.onStatus('connecting');

    let server: BulletServer;
    try {
      server = await fetchPrivateBullet();
    } catch (error) {
      socketLogFailure('token:private:fetch', error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const dialAt = Date.now();
    const endpoint = hostOf(server.endpoint);
    socketLog('dial:private', `${endpoint} attempt=${this.attempt}`);
    const url = `${server.endpoint}?token=${encodeURIComponent(server.token)}&pingInterval=${server.pingInterval}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    this.pingIntervalMs = server.pingInterval;
    this.lastServerAt = Date.now();
    // One instance server per attempt; after a sweep the token is soft-invalidated so the next
    // cycle signs a fresh one (spot returns a single server, so the sweep is quickly reached —
    // the cooldown holds the endpoint harmless).
    if (this.attempt > 0) invalidatePrivateBullet();

    // Every handler re-checks `stopped`. Closing a WebSocket is asynchronous and does not discard
    // work the event loop already dispatched, so a message from the previous session can still run
    // after stop() returned.

    // Dial deadline: no `onopen` in 3s means the handshake blackholed — retry now.
    this.connectTimer = setTimeout(() => {
      if (this.socket !== socket || this.stopped) return;
      socketLog('dial:private:timeout', `${endpoint} after ${Date.now() - dialAt}ms`);
      this.forceClose('open-timeout');
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return;
      socketLog('open:private', `${endpoint} ${Date.now() - dialAt}ms`);
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      // Session is not usable until the welcome frame — same gate as the public socket. The
      // welcome timeout arm lives in handleFrame.
      this.welcomeTimer = setTimeout(() => {
        if (this.socket !== socket || this.stopped) return;
        this.forceClose('welcome-timeout');
      }, WELCOME_TIMEOUT_MS);
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (this.socket !== socket || this.stopped) return;
      this.handleFrame(String(event.data), socket);
    };

    socket.onerror = () => {
      if (this.socket !== socket || this.stopped) return;
      socketLog('dial:private:error');
    };

    socket.onclose = (event: WebSocketCloseEvent) => {
      if (this.socket !== socket) return;
      this.clearSessionTimers();
      this.socket = null;
      socketLog('closed:private', `code=${event?.code ?? '-'} attempt=${this.attempt}`);
      // 4001/4002 mean the token itself is bad, so the cached one has to go or every reconnect
      // would fail the same way.
      if (event?.code === 4001 || event?.code === 4002) invalidatePrivateBullet({ hard: true });
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private handleFrame(raw: string, socket: WebSocket): void {
    this.lastServerAt = Date.now();

    // Bare-string keepalive frames from the server: answer so its session-side timeout — which
    // would otherwise close the connection mid-gap — stays satisfied.
    if (raw === 'ping') {
      if (socket.readyState === WebSocket.OPEN) socket.send('pong');
      return;
    }
    if (raw === 'pong') return;

    let message: { type?: string; topic?: string; data?: Record<string, unknown>; id?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case 'welcome':
        if (this.socket !== socket || this.stopped) return;
        if (this.welcomeTimer) {
          clearTimeout(this.welcomeTimer);
          this.welcomeTimer = null;
        }
        socketLog('welcome:private', `session=${String(message.id ?? '-')}`);
        this.attempt = 0;
        this.lastPingAt = this.lastServerAt;
        this.subscribe(socket);
        this.startHeartbeat(socket);
        this.listener.onStatus('live');
        return;
      case 'pong':
        return;
      case 'ack':
        socketLog('ack:private', String(message.topic ?? '-'));
        return;
      case 'error':
        socketLogFailure('server:private:error', JSON.stringify(message).slice(0, 200));
        return;
      case 'message': {
        if (!message.data || !message.topic) return;

        if (message.topic === ORDER_TOPIC) {
          const data = message.data;
          // An account-wide topic also carries non-spot books (futures, margin); those orders have
          // no place in a spot open-orders list and no spot cancel endpoint.
          if (data.symbol && !String(data.symbol).includes('-')) return;
          this.listener.onOrder(data as PrivateOrderMessage);
        } else if (message.topic === BALANCE_TOPIC) {
          this.listener.onBalance(message.data as PrivateBalanceMessage);
        }
        return;
      }
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.pingTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN || this.socket !== socket) return;
      socket.send(JSON.stringify({ id: nextMessageId(), type: 'ping' }));
      this.lastPingAt = Date.now();
    }, Math.max(this.pingIntervalMs / 2, 5_000));
    // A carrier NAT drop leaves the TCP state OPEN while the route is dead: sends vanish and no
    // close event ever arrives. Anything from the server — a pong, a data frame — proves the
    // route; silence after a ping does not. Without this, fills stop updating silently and the
    // list only catches up on the REST reconcile cadence.
    this.watchdogTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN || this.socket !== socket) return;
      const silent = Date.now() - this.lastServerAt;
      if (this.lastPingAt && silent > PONG_TIMEOUT_MS && this.lastServerAt < this.lastPingAt) {
        this.forceClose('pong-timeout');
      }
    }, 1_000);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
    this.listener.onStatus('offline');
    socketLog('reconnect:private:armed', `${delay}ms attempt=${this.attempt}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
