/**
 * The appearance inputs an app writes on `<html>` as StyleX classes, shared
 * by the app and the canvas shell so both resolve the same tokens the same
 * way: the colour scheme with the dark popup material, and the workspace
 * tint over `--nyte-custom-hue` and `--nyte-custom-chroma-scale`.
 */
import { create, createTheme, props } from "@stylexjs/stylex";
import type { CompiledStyles, StyleXArray } from "@stylexjs/stylex";
import { surfaceTheme } from "./surface-theme.ts";
import { displayMode } from "./tokens.stylex.ts";

const scheme = create({
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
});

const dark = createTheme(displayMode, {
  "--nyte-popup-material-filter": "blur(12px) brightness(120%)",
});

function toggle(styles: StyleXArray<CompiledStyles>, enabled: boolean): void {
  for (const name of (props(styles).className ?? "").split(" ")) {
    if (name !== "") document.documentElement.classList.toggle(name, enabled);
  }
}

/** `data-display-mode` stays for what reads the mode outside StyleX: Shiki and the terminal. */
export function applyDisplayMode(mode: "light" | "dark"): void {
  toggle([scheme.dark, dark], mode === "dark");
  toggle(scheme.light, mode === "light");
  document.documentElement.dataset["displayMode"] = mode;
}

export function applyTint(enabled: boolean): void {
  toggle(surfaceTheme.custom, enabled);
}
