import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const base = appJson.expo as ExpoConfig;

/**
 * Signal detection ships unless explicitly disabled, mirroring the JS-side default in
 * `src/lib/featureFlags.ts`. Set `EXPO_PUBLIC_SIGNAL_DETECTION=false` at build time to strip
 * the native listener (Kotlin sources, service, permissions) and the deep-link route wiring.
 * EAS reads this from the profile's `env`; the release workflow exports it before `expo
 * prebuild`, which is when this config is evaluated.
 */
const signalDetectionEnabled = process.env.EXPO_PUBLIC_SIGNAL_DETECTION !== 'false';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  ...base,
  scheme: 'snaptrade',
  plugins: [
    ...(base.plugins ?? []),
    // Writes the notification-listener Kotlin sources into the generated project and registers
    // the service, receiver, permissions and native package on every `expo prebuild`.
    ...(signalDetectionEnabled ? ['./plugins/withSignalNotifications'] : []),
  ],
  experiments: {
    ...base.experiments,
    typedRoutes: true,
  },
});
