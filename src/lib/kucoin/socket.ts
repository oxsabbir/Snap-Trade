const BASE_URL = 'https://api.kucoin.com';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 15_000;
const THROTTLE_MS = 200;

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

async function fetchBullet(): Promise<BulletResponse['instanceServers'][number] & { token: string }> {
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
    return { token: payload.data.token, ...payload.data.instanceServers[0] };
  } finally {
    clearTimeout(timer);
  }
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
  private attempt = 0;
  private stopped = true;
  private latest: TickerUpdate | null = null;
  private pendingSize = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly symbol: string,
    private readonly listener: Listener
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    // Drop anything already parsed but not yet flushed. Without this a tick that
    // arrived just before stop() is still delivered by its pending throttle timer,
    // which would land in whatever series the view has moved on to.
    this.latest = null;
    this.pendingSize = 0;
    this.socket?.close();
    this.socket = null;
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.listener.onStatus('connecting');

    let server: Awaited<ReturnType<typeof fetchBullet>>;
    try {
      server = await fetchBullet();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (this.stopped) return;

    const url = `${server.endpoint}?token=${encodeURIComponent(server.token)}&pingInterval=${server.pingInterval}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    // Every handler below re-checks `stopped`. Closing a WebSocket is asynchronous and
    // does not discard work the JS event loop has already dispatched, so a message or
    // error from the previous symbol can still run after stop() returned. Callers rely
    // on a stopped socket being completely inert.
    socket.onopen = () => {
      if (this.stopped) return;
      this.attempt = 0;
      socket.send(
        JSON.stringify({
          id: Date.now().toString(),
          type: 'subscribe',
          topic: `/market/ticker:${this.symbol}`,
          response: true,
        })
      );
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
        }
      }, Math.max(server.pingInterval / 2, 5_000));
      this.listener.onStatus('live');
    };

    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (this.stopped) return;
      let message: { type?: string; subject?: string; data?: RawTicker };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type !== 'message' || message.subject !== 'trade.ticker' || !message.data) return;

      const raw = message.data;
      const update: TickerUpdate = {
        symbol: this.symbol,
        price: Number(raw.price),
        size: Number(raw.size),
        time: Number(raw.time),
        bestAsk: Number(raw.bestAsk),
        bestBid: Number(raw.bestBid),
      };
      if (!Number.isFinite(update.price)) return;

      this.latest = update;
      if (Number.isFinite(update.size) && update.size > 0) this.pendingSize += update.size;
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          if (this.stopped || !this.latest) return;
          const size = this.pendingSize;
          this.pendingSize = 0;
          this.listener.onTick({ ...this.latest, size });
        }, THROTTLE_MS);
      }
    };

    socket.onerror = () => {
      if (this.stopped) return;
      this.listener.onStatus('offline');
    };

    socket.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.socket === socket) this.socket = null;
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
