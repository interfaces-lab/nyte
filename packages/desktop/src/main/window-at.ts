import type { BrowserWindow, Point } from "electron";

/** Whether `point`, in screen coordinates, falls on any of `windows`. */
export function windowAt(windows: Iterable<BrowserWindow>, point: Point): boolean {
  return [...windows].some((window) => {
    if (window.isDestroyed()) return false;
    const bounds = window.getBounds();

    return (
      point.x >= bounds.x &&
      point.x < bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y < bounds.y + bounds.height
    );
  });
}
