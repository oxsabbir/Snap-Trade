import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const base = appJson.expo as ExpoConfig;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  ...base,
  scheme: 'snaptrade',
  linking: {
    prefixes: ['snaptrade://'],
    config: {
      screens: {
        onboarding: 'onboarding',
        'trade/[symbol]': 'trade/:symbol',
        '(tabs)': {
          screens: {
            index: '',
            trade: 'trade',
            account: 'account',
          },
        },
      },
    },
  },
  experiments: {
    ...base.experiments,
    typedRoutes: true,
  },
});
