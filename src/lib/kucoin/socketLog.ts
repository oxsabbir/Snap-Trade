/**
 * Phase logging for the socket layer, strictly opt-in: `EXPO_PUBLIC_SOCKET_DEBUG=true`.
 *
 * The value this works against is answering "where did the connect get stuck" from the field
 * without a debugger — token fetches, dial starts, opens, welcomes, every retry. Off by
 * default so production logs stay clean; the release workflow exports the variable only when
 * a debug build is wanted.
 */
const SOCKET_DEBUG_ENABLED = process.env.EXPO_PUBLIC_SOCKET_DEBUG === 'true';

export function socketLog(phase: string, detail = ''): void {
  if (!SOCKET_DEBUG_ENABLED) return;
  const now = new Date();
  const clock = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  console.log(`[kucoin-ws ${clock}.${ms}] ${phase}${detail ? ` ${detail}` : ''}`);
}

export function socketLogFailure(phase: string, detail: string): void {
  if (!SOCKET_DEBUG_ENABLED) return;
  console.log(`[kucoin-ws] ${phase} FAILED ${detail}`);
}
