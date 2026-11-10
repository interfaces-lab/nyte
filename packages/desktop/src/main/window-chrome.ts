import { nativeTheme } from "electron";
import { macOSTrafficLightPosition } from "./traffic-lights.ts";

export function macOSWindowChrome(): Partial<Electron.BrowserWindowConstructorOptions> {
  const options: Partial<Electron.BrowserWindowConstructorOptions> = {
    acceptFirstMouse: true,
    hasShadow: true,
    titleBarOverlay: true,
    titleBarStyle: "hidden",
    trafficLightPosition: macOSTrafficLightPosition(1),
  };

  if (!nativeTheme.shouldUseHighContrastColors) {
    options.vibrancy = "sidebar";
    options.visualEffectState = "active";
  }

  return options;
}

export function windowBackgroundColor(): string {
  if (process.platform !== "darwin" || nativeTheme.shouldUseHighContrastColors) {
    return nativeTheme.shouldUseDarkColors ? "#1b1b1b" : "#ffffff";
  }

  return nativeTheme.shouldUseDarkColors ? "#40000000" : "#00ffffff";
}
