import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const base = appJson.expo as ExpoConfig;

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    ...base,
    scheme: 'snaptrade',
    plugins: [...(base.plugins ?? [])],
    experiments: {
      ...base.experiments,
      typedRoutes: true,
    },
  };
};
