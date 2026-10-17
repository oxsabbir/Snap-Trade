/**
 * Build-time feature switches.
 *
 * `EXPO_PUBLIC_*` values are inlined as string literals by Metro when the JS bundle is built,
 * so each branch below is statically known at bundle time and the minifier drops the dead
 * side. The native counterpart lives in `app.config.ts`, which reads the same variable to
 * decide whether the notification-listener config plugin is applied on `prebuild`.
 *
 * Semantics: the feature ships unless it is explicitly disabled, so a plain `expo start` or a
 * CI run with no configuration keeps signal detection.
 */
export const SIGNAL_DETECTION_ENABLED = process.env.EXPO_PUBLIC_SIGNAL_DETECTION !== 'false';
