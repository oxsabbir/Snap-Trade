import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const base = appJson.expo as ExpoConfig;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  ...base,
  scheme: 'snaptrade',
  experiments: {
    ...base.experiments,
    typedRoutes: true,
  },
});
