/**
 * Signal pipeline logging.
 *
 * The native listener and the JS route both write through this so the two halves of the
 * detect-and-launch path share one tag and one timestamp format, which makes `adb logcat -s
 * SnapTrade` read as a single sequence rather than two interleaved streams.
 */
const TAG = 'SnapTrade';

function timestamp(): number {
  return Date.now();
}

export function snapLog(stage: string, message: string): void {
  console.log(`${TAG} ${timestamp()} ${stage} ${message}`);
}
