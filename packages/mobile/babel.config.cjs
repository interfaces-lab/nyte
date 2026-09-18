module.exports = function (api) {
  const platform = api.caller((caller) => caller?.platform ?? "ios");
  const dev = api.caller(
    (caller) =>
      caller?.isDev ??
      (process.env.BABEL_ENV === "development" || process.env.NODE_ENV === "development"),
  );

  return {
    presets: [
      "babel-preset-expo",
      ["react-strict-dom/babel-preset", { platform, dev, debug: dev }],
    ],
  };
};
