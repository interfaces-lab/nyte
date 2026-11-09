import packageMetadata from "../package.json" with { type: "json" };

declare const NYTE_BUILT_VERSION: string | undefined;

export const VERSION =
  typeof NYTE_BUILT_VERSION === "string" ? NYTE_BUILT_VERSION : packageMetadata.version;
