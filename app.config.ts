import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const base = appJson.expo as ExpoConfig;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  ...base,
  scheme: 'snaptrade',
  plugins: [
    ...(base.plugins ?? []),
    // Writes the notification-listener Kotlin sources into the generated project and registers
    // the service, receiver, permissions and native package on every `expo prebuild`.
    './plugins/withSignalNotifications',
  ],
  experiments: {
    ...base.experiments,
    typedRoutes: true,
  },
});
