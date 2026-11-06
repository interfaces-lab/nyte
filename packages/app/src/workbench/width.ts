import { elementVariable } from "../lib/element-variable.ts";
import { workbench } from "../theme/schema.stylex.ts";

const WORKBENCH_WIDTH_MIN = workbench.widthMin;

export const WORKBENCH_CENTER_WIDTH_MIN = workbench.centerWidthMin;

const activeWidth = elementVariable("--nyte-active-workbench-width", "500px");

export const attachActiveWorkbenchWidth = activeWidth.attach;

export function setActiveWorkbenchWidth(width: number): void {
  activeWidth.set(`${String(width)}px`);
}

export type WorkbenchWidth = { readonly pixels: number };

export const DEFAULT_WIDTH: WorkbenchWidth = Object.freeze({ pixels: workbench.widthDefault });

type WorkbenchWidthBounds =
  | { readonly kind: "docked"; readonly min: number; readonly max: number }
  | { readonly kind: "overlay"; readonly min: number; readonly max: number };

export function workbenchPanelWidth(width: WorkbenchWidth, stageWidth: number): number {
  return clampWorkbenchWidthToBounds(width.pixels, workbenchWidthBounds(stageWidth));
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
