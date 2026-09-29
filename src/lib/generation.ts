/**
 * Keeps async loads from landing out of order.
 *
 * A symbol switch starts a second request while the first is still in flight, and both
 * resolve into the same consumer. `bump()` marks every already-issued request as
 * superseded; a response carrying an older snapshot must be dropped rather than written
 * over the current one. This matters because the guard for "is this still mounted?" is
 * not enough — the effect that fetches on a symbol switch re-arms that flag immediately,
 * so a slow response for the previous symbol passes an unmount check it should fail.
 */
export function createGenerationGuard() {
  let generation = 0;
  return {
    /** Invalidates every outstanding snapshot. Call when the target changes. */
    bump: () => ++generation,
    /** Captures the current generation for a request that is about to be issued. */
    snapshot: () => generation,
    /** False once the captured snapshot has been superseded, so the response must be dropped. */
    isCurrent: (token: number) => token === generation,
  };
}
