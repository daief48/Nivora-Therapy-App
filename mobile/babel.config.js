module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo adds the react-native-worklets (reanimated) plugin automatically.
  return { presets: ['babel-preset-expo'] };
};
