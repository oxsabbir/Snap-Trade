module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated's worklet transform. Added for react-native-reanimated 4, which moved the
    // transform out of reanimated itself and into react-native-worklets. It must stay last in
    // the plugin list or worklets are not compiled and every `useSharedValue`-driven gesture
    // silently falls back to the JS thread.
    plugins: ['react-native-worklets/plugin'],
  };
};
