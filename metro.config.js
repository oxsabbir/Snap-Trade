const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo's default config hardcodes `inlineRequires: false`, which evaluates every module reachable
// from the startup graph during boot. Inlining defers each require to first use, so chains that are
// only reachable from screens the user has not opened yet (charts/Skia, order-book, trade) do not
// execute on a cold start. Wrap rather than replace so any future Expo defaults are preserved.
const getTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);
  return {
    ...options,
    transform: {
      ...options.transform,
      inlineRequires: true,
    },
  };
};

module.exports = config;
