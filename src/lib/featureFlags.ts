/**
 * Build-time feature switches.
 *
 * `EXPO_PUBLIC_*` values are inlined as string literals by Metro when the JS bundle is built,
 * so each branch below is statically known at bundle time and the minifier drops the dead
 * side. The native counterpart lives in `app.config.ts`, which reads the same variable to
 * decide whether the notification-listener config plugin is applied on `prebuild`.
 *
 * Semantics: strict opt-in. The private build sets the variable to 'true'; every other
 * environment — a plain `expo start`, a CI run where the variable was never set, or a bundler
 * that lost the variable between Gradle and Metro — compiles the feature OUT. Defaulting to
 * enabled here is what once shipped the detection UI in the plain APK: an unset variable
 * read as `undefined !== 'false'` and passed the gate.
 */
export const SIGNAL_DETECTION_ENABLED = process.env.EXPO_PUBLIC_SIGNAL_DETECTION === 'true';
