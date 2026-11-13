/**
 * The public WebSocket token — its fetch, its cache, and the tiny REST wake call.
 *
 * The token comes from `POST /bullet-public` and is valid for 24h; the cache expires after 20h
 * so a long-lived app session never dials with a token near its expiry. `invalidatePublicBullet()`
 * drops the cache outright: the token is almost never the reason a dial fails — the carrier path
 * is — so the cache is NOT discarded per failed retry round. It is only dropped on hard evidence
 * (close 4001/4002, the manual reconnect button) or after three consecutive failed dials, and a
 * dropped cache refetches a token and resolves the host through DNS again — which is how a carrier
 * pinning one unreachable edge gets a fresh answer.
 */
import { request } from './client';
import { socketLog, socketLogFailure } from './socketLog';

const REQUEST_TIMEOUT_MS = 10_000;
/** Cache lifetime: inside KuCoin's 24h validity with a comfortable margin. */
const TTL_MS = 20 * 60 * 60 * 1000;

type BulletResponse = {
  token: string;
  instanceServers: {
    endpoint: string;
    pingInterval: number;
    pingTimeout: number;
  }[];
};

export type BulletServer = {
  endpoint: string;
  pingInterval: number;
  pingTimeout: number;
  token: string;
};

export type CachedBullet = {
  servers: BulletServer[];
  /** When the cache was filled — the "token older than 20h" age check reads this. */
  cachedAt: number;
  expiresAt: number;
};

let cached: CachedBullet | null = null;
let inFlight: Promise<CachedBullet> | null = null;

/**
 * Token + server list. One POST per fresh connect; instance servers are the CDN edges the
 * connect ladder rotates across. Public data — no signing.
 */
export async function fetchPublicBullet(): Promise<CachedBullet> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    socketLog('token:cache-hit', `age=${Math.round((now - cached.cachedAt) / 1000)}s`);
    return cached;
  }
  if (inFlight) return inFlight;

  socketLog('token:fetch:begin');
  const startedAt = now;
  inFlight = (async () => {
    try {
      const data = await request<BulletResponse>('/bullet-public', {
        method: 'POST',
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      if (!data?.instanceServers?.length) {
        throw new Error('bullet-public returned no instance servers');
      }
      const fresh: CachedBullet = {
        servers: data.instanceServers.map((entry) => ({ ...entry, token: data.token })),
        cachedAt: Date.now(),
        expiresAt: Date.now() + TTL_MS,
      };
      cached = fresh;
      socketLog(
        'token:fetch:done',
        `${fresh.servers.length} server(s), ${Date.now() - startedAt}ms, ttl 20h`
      );
      return fresh;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * One tiny public REST round trip. Fired in parallel with the reconnect on resume/network
 * change: it wakes the carrier radio (which a cold WS dial may otherwise race against) and
 * doubles as a cheap probe of whether the REST path — which users report as instant on GP —
 * is alive while the WS path is not. Errors are logged and swallowed; the WS ladder owns
 * recovery.
 */
export async function wakeRadio(): Promise<boolean> {
  const startedAt = Date.now();
  try {
    await request<unknown>('/timestamp', { timeoutMs: 5_000 });
    socketLog('wake:rest', `ok ${Date.now() - startedAt}ms`);
    return true;
  } catch (error) {
    socketLogFailure('wake:rest', error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Drops the cached token outright. Called on hard evidence only: close 4001/4002 (KuCoin
 * rejected the token), the manual reconnect button, or three consecutive failed dials. There
 * is no soft mode — a failed retry round reuses the cached token, because the path, not the
 * token, is what usually fails, and refetching per round would hammer the rate-limited
 * endpoint without improving the odds.
 */
export function invalidatePublicBullet(): void {
  if (!cached) return;
  cached = null;
  socketLog('token:invalidate');
}
