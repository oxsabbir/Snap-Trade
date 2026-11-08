/**
 * The public WebSocket token — its fetch, its cache, and the tiny REST wake call.
 *
 * The token comes from `POST /bullet-public` and is valid for 24h; the cache front-runs that
 * by expiring after ~6h so a long-lived app session never dials with a token that is about to
 * be rejected mid-flight. `invalidatePublicBullet()` forces the next dial to refetch: an
 * invalid token (close 4001/4002) or a failed connect sweep means the cached answer itself is
 * worthless, and the refetch also resolves the host through DNS again — which is how a carrier
 * pinning one unreachable edge gets a fresh answer.
 */
import { request } from './client';
import { socketLog, socketLogFailure } from './socketLog';

const REQUEST_TIMEOUT_MS = 10_000;
/** Cache lifetime; comfortably inside KuCoin's 24h token validity. */
const TTL_MS = 6 * 60 * 60 * 1000;
/**
 * After a *soft* invalidation (retry-sweep rotation), the refetch is held off this long so a
 * fast-failing retry ladder cannot hammer `bullet-public` — the rate-limited endpoint — while
 * the path itself is down. Hard invalidations (rejected token) always refetch immediately.
 */
const REFETCH_COOLDOWN_MS = 5_000;

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
  if (cached && cached.expiresAt > now) return cached;
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
        expiresAt: Date.now() + TTL_MS,
      };
      cached = fresh;
      socketLog(
        'token:fetch:done',
        `${fresh.servers.length} server(s), ${Date.now() - startedAt}ms, ttl 6h`
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
 * Drops the cached token. `hard` marks it provably wrong (KuCoin rejected the token, close
 * 4001/4002) and discards immediately; a soft invalidation marks it stale for the next connect
 * cycle without triggering a refetch inside the cooldown.
 */
export function invalidatePublicBullet(options: { hard?: boolean } = {}): void {
  if (options.hard) {
    cached = null;
    socketLog('token:invalidate:hard');
    return;
  }
  if (!cached) return;
  // Keep the entry servable during the cooldown, but cap its remaining life, so the next dial
  // after the cooldown expires refetches — that is what makes a soft invalidation eventually
  // resolve the host through DNS again.
  cached = { ...cached, expiresAt: Math.min(cached.expiresAt, Date.now() + REFETCH_COOLDOWN_MS) };
  socketLog('token:invalidate:soft');
}
