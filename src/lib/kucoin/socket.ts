import { AppState } from 'react-native';

const BASE_URL = 'https://api.kucoin.com';
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Reconnect wait cap, reached only after escalating failures (1s → 2s → 4s → 5s). Shorts cap
 * because the common mobile-data failure is one-sided: the route dies while KuCoin stays fine,
 * and the path is usually usable again within seconds — a long wall of waiting would just be
 * dead green-dot time. Foregrounding the app retries instantly regardless.
 */
const MAX_BACKOFF_MS = 5_000;
const THROTTLE_MS = 200;

/** Deadlines for socket health, mirroring `level2.ts` (carrier-safe reconnects). */
const CONNECT_TIMEOUT_MS = 10_000;
const LIVENESS_MS = 25_000;
const LIVENESS_CHECK_MS = 5_000;

export type TickerUpdate = {
  symbol: string;
  price: number;
  /**
   * Traded base-currency volume accumulated across the whole throttle window, not
   * just the last trade. The throttle keeps only the newest price, so summing here
   * is the only way the live candle's volume stays honest.
   */
  size: number;
  time: number;
  bestAsk: number;
  bestBid: number;
};

export type SocketStatus = 'connecting' | 'live' | 'offline';

type BulletResponse = {
  token: string;
  instanceServers: {
    endpoint: string;
    pingInterval: number;
    pingTimeout: number;
  }[];
};

type RawTicker = {
  sequence: string;
  price: string;
  size: string;
  bestAsk: string;
  bestAskSize: string;
  bestBid: string;
  bestBidSize: string;
  time: string;
};

type Listener = {
  onTick: (update: TickerUpdate) => void;
  onStatus: (status: SocketStatus) => void;
};

type BulletServer = BulletResponse['instanceServers'][number] & { token: string };

type CachedBullet = { token: string; servers: BulletServer[]; expiresAt: number };
let cachedBullet: CachedBullet | null = null;
let bulletPromise: Promise<CachedBullet> | null = null;
const BULLET_TTL_MS = 60 * 60 * 1000; // 1 hour (KuCoin tokens last 24h)

/**
 * Fetches the public token and **all** the instance servers KuCoin offers, callers rotating
 * across them (see `level2.ts`): different endpoints are different CDN edges, and carrier-
 * class paths (Grameenphone in particular) routinely break the route to one while the rest
 * remain reachable — so a single forced choice turned one dead edge into an hour-long lock.
 */
export async function fetchBulletServers(): Promise<CachedBullet> {
  const now = Date.now();
  if (cachedBullet && cachedBullet.expiresAt > now) {
    return cachedBullet;
  }
  if (bulletPromise) return bulletPromise;

  bulletPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE_URL}/api/v1/bullet-public`, {
        method: 'POST',
        signal: controller.signal,
      });
      const payload = (await response.json()) as { code?: string; data?: BulletResponse };
      if (!payload.data?.instanceServers?.length) {
        throw new Error(`Token request failed: ${payload.code ?? response.status}`);
      }
      const data: CachedBullet = {
        token: payload.data.token,
        servers: payload.data.instanceServers.map((entry) => ({ ...entry, token: payload.data!.token! })),
        expiresAt: now + BULLET_TTL_MS,
      };
      cachedBullet = data;
      return data;
    } finally {
      clearTimeout(timer);
      bulletPromise = null;
    }
  })();

  return bulletPromise;
}

export function invalidateBullet(): void {
  cachedBullet = null;
}

/**
 * Streams BBO/last-trade updates for one symbol over KuCoin's public spot feed.
 * Reconnects with backoff and throttles delivery, since BTC ticks ~10x a second
 * and re-rendering a chart that often is wasted work.
 */
export class TickerSocket {
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  /** Last moment the server demonstrably answered (a tick or a pong). */
  private lastMessageAt = 0;
  private attempt = 0;
  private stopped = true;
  private appStateSubscription: { remove(): void } | null = null;
  private latest: TickerUpdate | null = null;
  private pendingSize = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmit = 0;

  constructor(
    private readonly symbol: string,
    private readonly listener: Listener
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // Android tears down cellular routes while the app is backgrounded; coming back to the
    // foreground is the natural moment to stop waiting out a long backoff and try again now.
    this.appStateSubscription?.remove();
    this.appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || this.stopped || this.reconnectTimer === null) return;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      void this.connect();
    });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.clearTimers();
    // Drop anything already parsed but not yet flushed. Without this a tick that
    // arrived just before stop() is still delivered by its pending throttle timer,
    // which would land in whatever series the view has moved on to.
    this.latest = null;
    this.pendingSize = 0;
    this.lastEmit = 0;
    this.socket?.close();
    this.socket = null;
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
    this.connectTimer = null;
    this.liveTimer = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.listener.onStatus('connecting');

    let bullet: Awaited<ReturnType<typeof fetchBulletServers>>;
    try {
      bullet = await fetchBulletServers();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    // One instance server per retry attempt: after a full sweep, refresh the bullet too, so
    // a dead cache (too-far edge or expired token) costs at most one sweep before fresh data.
    const servers = bullet.servers;
    const server = servers[this.attempt % servers.length]!;
    if (this.attempt > 0 && this.attempt % servers.length === 0) invalidateBullet();

    const url = `${server.endpoint}?token=${encodeURIComponent(server.token)}&pingInterval=${server.pingInterval}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    // A handshake can stall forever without ever firing onopen/onerror/onclose; without this
    // deadline the chart's status dot sits on "connecting" indefinitely.
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.stopped || this.socket !== socket || socket.readyState === WebSocket.OPEN) {
        return;
      }
      socket.onopen = socket.onerror = socket.onmessage = socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Some runtimes refuse to close a CONNECTING socket; dropping the reference is enough.
      }
      this.socket = null;
      this.scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);

    // Every handler below re-checks `stopped`. Closing a WebSocket is asynchronous and
    // does not discard work the JS event loop has already dispatched, so a message or
    // error from the previous symbol can still run after stop() returned. Callers rely
    // on a stopped socket being completely inert.
    socket.onopen = () => {
      if (this.stopped) return;
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.attempt = 0;
      socket.send(
        JSON.stringify({
          id: Date.now().toString(),
          type: 'subscribe',
          topic: `/market/ticker:${this.symbol}`,
          response: true,
        })
      );
      this.lastMessageAt = Date.now();
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
        }
      }, Math.max(server.pingInterval / 2, 5_000));
      // While OPEN but route-dead (carrier NAT drop), a send vanishes silently and no close
      // event ever arrives; the server ponging our pings is the only honest heartbeat.
      this.liveTimer = setInterval(() => {
        if (this.stopped || socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.lastMessageAt > LIVENESS_MS) {
          socket.close();
        }
      }, LIVENESS_CHECK_MS);
      this.listener.onStatus('live');
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (this.stopped) return;
      this.lastMessageAt = Date.now();
      const raw = String(event.data);
      // The server also pings with a bare string frame; answering keeps its keepalive
      // satisfied, which is what a carrier-imposed idle timeout measures.
      if (raw === 'ping') {
        if (socket.readyState === WebSocket.OPEN) socket.send('pong');
        return;
      }
      let message: { type?: string; subject?: string; data?: RawTicker };
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (message.type !== 'message' || message.subject !== 'trade.ticker' || !message.data) return;

      const tick = message.data;
      const update: TickerUpdate = {
        symbol: this.symbol,
        price: Number(tick.price),
        size: Number(tick.size),
        time: Number(tick.time),
        bestAsk: Number(tick.bestAsk),
        bestBid: Number(tick.bestBid),
      };
      if (!Number.isFinite(update.price)) return;

      this.latest = update;
      if (Number.isFinite(update.size) && update.size > 0) this.pendingSize += update.size;

      const now = Date.now();
      // Leading edge: deliver immediately if outside the throttle window (e.g. first tick)
      if (!this.lastEmit || now - this.lastEmit >= THROTTLE_MS) {
        if (this.flushTimer) {
          clearTimeout(this.flushTimer);
          this.flushTimer = null;
        }
        this.lastEmit = now;
        const size = this.pendingSize;
        this.pendingSize = 0;
        this.listener.onTick({ ...this.latest, size });
        return;
      }

      // Trailing edge: batch high-frequency updates into the 200ms window
      if (!this.flushTimer) {
        const remaining = THROTTLE_MS - (now - this.lastEmit);
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          if (this.stopped || !this.latest) return;
          this.lastEmit = Date.now();
          const size = this.pendingSize;
          this.pendingSize = 0;
          this.listener.onTick({ ...this.latest, size });
        }, Math.max(0, remaining));
      }
    };

    socket.onerror = () => {
      if (this.stopped) return;
      this.listener.onStatus('offline');
    };

    socket.onclose = (event: WebSocketCloseEvent) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.socket === socket) this.socket = null;
      if (event?.code === 4001 || event?.code === 4002) {
        invalidateBullet();
      }
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt += 1;
    const delay = Math.min(1000 * 2 ** (this.attempt - 1), MAX_BACKOFF_MS);
    this.listener.onStatus('offline');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
