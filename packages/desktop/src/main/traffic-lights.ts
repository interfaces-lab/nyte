import { release } from "node:os";
import { macOSWindowButtonHeight } from "@nyte-ai/app/contract/window-buttons.ts";

const TITLEBAR_HEIGHT = 40;

export function macOSTrafficLightPosition(zoomFactor: number): Electron.Point {
  const diameter = macOSWindowButtonHeight(release());

  return {
    x: Math.floor((TITLEBAR_HEIGHT - diameter) / 2) + 1,
    y: Math.max(0, Math.round((TITLEBAR_HEIGHT * zoomFactor - diameter) / 2)),
  };
}
