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

type WorkbenchWidthBounds = {
  readonly narrow: boolean;
  readonly min: number;
  readonly max: number;
};

export function workbenchPanelWidth(width: WorkbenchWidth, stageWidth: number): number {
  return clampWorkbenchWidthToBounds(width.pixels, workbenchWidthBounds(stageWidth));
}

export function workbenchWidthBounds(availableWidth: number): WorkbenchWidthBounds {
  const width = Math.max(0, Math.floor(availableWidth));

  return Object.freeze({
    narrow: width < WORKBENCH_WIDTH_MIN + WORKBENCH_CENTER_WIDTH_MIN,
    min: WORKBENCH_WIDTH_MIN,
    max: Math.max(WORKBENCH_WIDTH_MIN, width - WORKBENCH_CENTER_WIDTH_MIN),
  });
}

export function clampWorkbenchWidthToBounds(width: number, bounds: WorkbenchWidthBounds): number {
  const normalized = Number.isFinite(width) ? Math.round(width) : bounds.min;

  return Math.min(bounds.max, Math.max(bounds.min, normalized));
}
