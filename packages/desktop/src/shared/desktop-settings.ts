import { Type } from "typebox";
import type { Static } from "typebox";

export const DESKTOP_SETTING_SCHEMAS = {
  keepAwake: Type.Boolean(),
  pauseOnSleep: Type.Boolean(),
  terminalShell: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  blockAds: Type.Boolean(),
  adblockAllowedHosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 })),
  upgradeToHttps: Type.Boolean(),
};

export type DesktopSettings = {
  readonly [K in keyof typeof DESKTOP_SETTING_SCHEMAS]: Static<(typeof DESKTOP_SETTING_SCHEMAS)[K]>;
};

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  keepAwake: false,
  pauseOnSleep: true,
  terminalShell: null,
  blockAds: true,
  adblockAllowedHosts: [],
  upgradeToHttps: true,
};
