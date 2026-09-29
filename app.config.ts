import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const base = appJson.expo as ExpoConfig;

const kucoin = {
  apiKey: process.env.KUCOIN_API_KEY,
  apiSecret: process.env.KUCOIN_API_SECRET,
  apiPassphrase: process.env.KUCOIN_API_PASSPHRASE,
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  ...base,
  scheme: 'kucoin',
  experiments: {
    ...base.experiments,
    typedRoutes: true,
  },
  extra: {
    ...base.extra,
    kucoin,
  },
});
