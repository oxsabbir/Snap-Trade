/**
 * Phase logging for the socket layer, with an in-memory ring buffer for the in-app copy button.
 *
 * Two outputs, two gates:
 *
 *  - The ring buffer records EVERY phase line, always. It is capped and cheap, and it is what
 *    `getSocketLogText()` serves to the debug tools' copy button — so a release build with no
 *    debug env can still hand over a connect timeline from the field, where adb is not available.
 *  - The console (adb logcat) output only emits when `EXPO_PUBLIC_SOCKET_DEBUG=true`, so
 *    production logcat stays clean; CI exports the variable only when a debug build is wanted.
 *
 * The debug tools themselves (freeze, copy, clear) are additionally gated by
 * `EXPO_PUBLIC_SOCKET_TOOLS=true` at their UI entry point — one clearly-named flag, so the lite
 * build simply does not set it.
 */
const SOCKET_DEBUG_ENABLED = process.env.EXPO_PUBLIC_SOCKET_DEBUG === 'true';

/** ~400 lines of phase history; a connect session is well inside this, memory is negligible. */
const MAX_ENTRIES = 400;

type LogEntry = {
  /** Wall-clock milliseconds — formatted lazily so storage stays a number. */
  at: number;
  text: string;
};

const ring: LogEntry[] = [];

function clockOf(at: number): string {
  const now = new Date(at);
  const clock = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':');
  return `${clock}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

export function socketLog(phase: string, detail = ''): void {
  const at = Date.now();
  const text = `${phase}${detail ? ` ${detail}` : ''}`;
  ring.push({ at, text });
  if (ring.length > MAX_ENTRIES) ring.shift();
  if (!SOCKET_DEBUG_ENABLED) return;
  console.log(`[kucoin-ws ${clockOf(at)}] ${text}`);
}

export function socketLogFailure(phase: string, detail: string): void {
  socketLog(phase, `FAILED ${detail}`);
}

/** The whole buffer as one compact copyable block, oldest first. */
export function getSocketLogText(): string {
  if (ring.length === 0) return 'no socket log entries yet';
  return ring.map((entry) => `${clockOf(entry.at)} ${entry.text}`).join('\n');
}

export function clearSocketLogText(): void {
  ring.length = 0;
}
