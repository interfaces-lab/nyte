/** The channels between main and an offscreen canvas preview's window (`preload/canvas-preview.ts`). */
export const CANVAS_PREVIEW_CHANNELS = {
  /** Main to the window, once the shell has loaded: the request to preview. */
  run: "nyte:canvas-preview-run",
  /** The window to main: set the viewport, in CSS pixels, and wait for it to paint. */
  resize: "nyte:canvas-preview-resize",
  /** The window to main: a PNG of the viewport. */
  capture: "nyte:canvas-preview-capture",
  /** The window to main: the report, or why the run failed. */
  outcome: "nyte:canvas-preview-outcome",
} as const;
