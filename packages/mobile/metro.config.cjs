const { execFileSync } = require("node:child_process");

const { join } = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");

const { wrapWithReanimatedMetroConfig } = require("react-native-reanimated/metro-config");

execFileSync(process.execPath, [join(__dirname, "scripts/sync-completion-icons.mjs")], {
  cwd: __dirname,
  stdio: "inherit",
});

module.exports = wrapWithReanimatedMetroConfig(getDefaultConfig(__dirname));
