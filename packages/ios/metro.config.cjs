const { getDefaultConfig } = require("expo/metro-config");
const { wrapWithReanimatedMetroConfig } = require("react-native-reanimated/metro-config");

module.exports = wrapWithReanimatedMetroConfig(getDefaultConfig(__dirname));
