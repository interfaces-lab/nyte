export const WORKBENCH_SHARE_DEFAULT = 0.5;

const WORKBENCH_WIDTH_MIN = 384;

export const WORKBENCH_CENTER_WIDTH_MIN = 424;

export const WORKBENCH_ACTIVE_WIDTH_VARIABLE = "--nyte-active-workbench-width";

/** A panel's width: a share of the stage, or the pixels stored before shares until the next resize. */
export type WorkbenchWidth = ShareWidth | { readonly kind: "pixels"; readonly pixels: number };

type ShareWidth = { readonly kind: "share"; readonly share: number };

export const DEFAULT_WIDTH: ShareWidth = Object.freeze({
  kind: "share",
  share: WORKBENCH_SHARE_DEFAULT,
});

type WorkbenchWidthBounds =
  | { readonly kind: "docked"; readonly min: number; readonly max: number }
  | { readonly kind: "overlay"; readonly min: number; readonly max: number };

export function shareWidth(share: number): ShareWidth {
  return Number.isFinite(share) && share > 0
    ? { kind: "share", share: Math.min(1, share) }
    : DEFAULT_WIDTH;
}

/** The panel's width in pixels on a stage `stageWidth` wide, kept inside the stage's bounds. */
export function workbenchPanelWidth(width: WorkbenchWidth, stageWidth: number): number {
  return clampWorkbenchWidthToBounds(
    width.kind === "share" ? width.share * stageWidth : width.pixels,
    workbenchWidthBounds(stageWidth),
  );
}

export function workbenchWidthBounds(availableWidth: number): WorkbenchWidthBounds {
  const width = Math.max(0, Math.floor(availableWidth));

  if (width < WORKBENCH_WIDTH_MIN + WORKBENCH_CENTER_WIDTH_MIN) {
    return Object.freeze({
      kind: "overlay",
      min: Math.min(WORKBENCH_WIDTH_MIN, width),
      max: width,
    });
  }

  return Object.freeze({
    kind: "docked",
    min: WORKBENCH_WIDTH_MIN,
    max: width - WORKBENCH_CENTER_WIDTH_MIN,
  });
}

export function clampWorkbenchWidthToBounds(width: number, bounds: WorkbenchWidthBounds): number {
  const normalized = Number.isFinite(width) ? Math.round(width) : bounds.min;

  return Math.min(bounds.max, Math.max(bounds.min, normalized));
}
