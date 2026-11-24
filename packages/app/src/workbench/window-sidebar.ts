import { elementVariable } from "../lib/element-variable.ts";
import type { ElementVariable } from "../lib/element-variable.ts";
import { SIDEBAR_WIDTH } from "../preferences/index.ts";
import { appShape } from "./app-shape.ts";

let width: ElementVariable | undefined;

function pixels(value: number): string {
  return `${String(value)}px`;
}

function widthVariable(): ElementVariable {
  if (width !== undefined) return width;
  const stored = appShape().sidebar.width;
  const created = elementVariable("--nyte-sidebar-width", pixels(stored.get()));

  stored.subscribe(() => created.set(pixels(stored.get())));
  width = created;

  return created;
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return appShape().sidebar.width.get();

  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(value)));
}

export function attachSidebarWidth(element: HTMLElement | null): (() => void) | undefined {
  return widthVariable().attach(element);
}

/** Previews a width while the person drags, without storing it. */
export function applySidebarWidth(value: number): void {
  widthVariable().set(pixels(value));
}

export const windowSidebar = Object.freeze({
  toggle(): void {
    const visible = appShape().sidebar.visible;

    visible.set(!visible.get());
  },
  setOpen(open: boolean): void {
    appShape().sidebar.visible.set(open);
  },
  setWidth(value: number): void {
    appShape().sidebar.width.set(clampSidebarWidth(value));
  },
});
