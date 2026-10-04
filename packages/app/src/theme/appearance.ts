/**
 * The appearance settings as StyleX classes on <html>. Each concern is its own
 * token group, so its variant only ever adds or removes its own classes.
 */
import { create, createTheme, props } from "@stylexjs/stylex";
import type { CompiledStyles, StyleXArray } from "@stylexjs/stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { displayMode, focusModality, pointerCursor, transparency } from "@nyte-ai/ui/tokens.stylex";

const scheme = create({
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
});

const dark = createTheme(displayMode, {
  "--nyte-popup-material-filter": "blur(12px) brightness(120%)",
});

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

/** `data-display-mode` stays for what reads the mode outside StyleX: Shiki and the terminal. */
export function applyDisplayMode(mode: "light" | "dark"): void {
  toggle([scheme.dark, dark], mode === "dark");
  toggle(scheme.light, mode === "light");
  document.documentElement.dataset["displayMode"] = mode;
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

export function applyTint(enabled: boolean): void {
  toggle(surfaceTheme.custom, enabled);
}
