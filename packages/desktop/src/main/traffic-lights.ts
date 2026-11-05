/** The app's titlebar height, `--nyte-titlebar-height`; the window buttons center in it. */
const TITLEBAR_HEIGHT = 40;

export function macOSTrafficLightPosition(zoomFactor: number): Electron.Point {
  const diameter = Number.parseFloat(process.getSystemVersion()) >= 25 ? 14 : 16;

  return {
    x: Math.floor((TITLEBAR_HEIGHT - diameter) / 2) + 1,
    y: Math.max(0, Math.round((TITLEBAR_HEIGHT * zoomFactor - diameter) / 2)),
  };
}
