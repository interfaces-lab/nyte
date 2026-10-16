/**
 * The appearance settings as StyleX classes on <html>. Each concern is its own
 * token group, so its variant only ever adds or removes its own classes. The
 * colour scheme and the tint live in `@nyte-ai/ui/appearance`, shared with
 * the canvas shell.
 */
import { createTheme, props } from "@stylexjs/stylex";
import type { CompiledStyles, StyleXArray } from "@stylexjs/stylex";
import { focusModality, pointerCursor, transparency } from "@nyte-ai/ui/styles/tokens.stylex";

const arrow = createTheme(pointerCursor, { "--nyte-cursor-interactive": "default" });

const opaque = createTheme(transparency, { "--nyte-reduce-transparency": "1" });

const quiet = createTheme(focusModality, { "--nyte-focus-ring": "transparent" });

function toggle(styles: StyleXArray<CompiledStyles>, enabled: boolean): void {
  for (const name of (props(styles).className ?? "").split(" ")) {
    if (name !== "") document.documentElement.classList.toggle(name, enabled);
  }
}

export function withoutTransitions(change: () => void): void {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none !important}";
  document.head.append(style);
  change();
  void getComputedStyle(document.body).transitionDuration;
  requestAnimationFrame(() => style.remove());
}

export function applyPointerCursors(enabled: boolean): void {
  toggle(arrow, !enabled);
}

export function applyTransparency(reduced: boolean): void {
  toggle(opaque, reduced);
}

/** Chromium matches `:focus-visible` on pointer focus in fields, so the ring's colour gates it. */
export function applyFocusModality(modality: "keyboard" | "pointer"): void {
  toggle(quiet, modality === "pointer");
}

let reduceTransparencyQuery: MediaQueryList | undefined;

/** Lazy, so importing this module needs no window; tests load it under node. */
function transparencyQuery(): MediaQueryList {
  return (reduceTransparencyQuery ??= window.matchMedia("(prefers-reduced-transparency: reduce)"));
}

export function systemReducesTransparency(): boolean {
  return transparencyQuery().matches;
}

export function subscribeSystemTransparency(listener: () => void): () => void {
  transparencyQuery().addEventListener("change", listener);

  return () => transparencyQuery().removeEventListener("change", listener);
}
