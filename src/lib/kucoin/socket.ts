/**
 * Compatibility shim. The public market data now flows through the single connection in
 * `publicSocket.ts`, and the token lives in `bullet.ts`; both historical import paths keep
 * resolving here. The per-symbol `TickerSocket` class and its dial machinery are gone —
 * reconnects, heartbeats and rate limiting are the manager's job now.
 */
export {
  fetchPublicBullet as fetchBulletServers,
  invalidatePublicBullet as invalidateBullet,
} from './bullet';
export type { TickerUpdate, SocketStatus, PublicTopicMessage } from './publicSocket';
