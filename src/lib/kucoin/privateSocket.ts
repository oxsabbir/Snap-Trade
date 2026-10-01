/**
 * KuCoin's private spot WebSocket: order changes and balance changes for the connected account.
 *
 * This is a second socket rather than an extra topic on `TickerSocket` because the two need
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
 */
import { request } from '@/lib/kucoin/client';
import { getCachedCredentials } from '@/lib/kucoin/credentials';

const MAX_BACKOFF_MS = 15_000;
const BULLET_TTL_MS = 60 * 60 * 1000; // tokens last 24h; re-fetch hourly to stay well inside it

const ORDER_TOPIC = '/spotMarket/tradeOrdersV2';
const BALANCE_TOPIC = '/account/balance';

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
 * Asks for a signed connection token. Unlike the public one this cannot be cached across a
 * signed-out session, so it is only ever fetched once a caller confirms credentials exist.
 */
export async function fetchPrivateBullet(): Promise<BulletServer> {
  const now = Date.now();
  if (cachedBullet && cachedBullet.expiresAt > now) return cachedBullet;
  if (bulletPromise) return bulletPromise;

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
      return data;
    } finally {
      bulletPromise = null;
    }
  })();

  return bulletPromise;
}

export function invalidatePrivateBullet(): void {
  cachedBullet = null;
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
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
    this.socket?.close();
    this.socket = null;
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
  }

  private subscribe(socket: WebSocket): void {
    // `privateChannel` is the string "true" on these topics, not a boolean — the docs show it
    // quoted and the exchange ignores the subscription when it is not.
    for (const topic of [ORDER_TOPIC, BALANCE_TOPIC]) {
      socket.send(
        JSON.stringify({
          id: Date.now().toString(),
          type: 'subscribe',
          topic,
          response: true,
          privateChannel: 'true',
        })
      );
    }
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
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const url = `${server.endpoint}?token=${encodeURIComponent(server.token)}&pingInterval=${server.pingInterval}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    // Every handler re-checks `stopped`. Closing a WebSocket is asynchronous and does not discard
    // work the event loop already dispatched, so a message from the previous session can still run
    // after stop() returned.
    socket.onopen = () => {
      if (this.stopped) return;
      this.attempt = 0;
      this.subscribe(socket);
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
        }
      }, Math.max(server.pingInterval / 2, 5_000));
      this.listener.onStatus('live');
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (this.stopped) return;
      let message: { type?: string; topic?: string; data?: Record<string, unknown> };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      // "welcome", "ack" and "pong" frames share `type: message` handling and carry no data.
      if (message.type !== 'message' || !message.data) return;

      if (message.topic === ORDER_TOPIC) {
        const data = message.data;
        // An account-wide topic also carries non-spot books (futures, margin); those orders have
        // no place in a spot open-orders list and no spot cancel endpoint.
        if (data.symbol && !String(data.symbol).includes('-')) return;
        this.listener.onOrder(data as PrivateOrderMessage);
      } else if (message.topic === BALANCE_TOPIC) {
        this.listener.onBalance(message.data as PrivateBalanceMessage);
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
      // 4001/4002 mean the token itself is bad, so the cached one has to go or every reconnect
      // would fail the same way.
      if (event?.code === 4001 || event?.code === 4002) invalidatePrivateBullet();
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
