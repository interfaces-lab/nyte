import { create, createTheme, props } from "@stylexjs/stylex";
import type { CompiledStyles, StyleXArray } from "@stylexjs/stylex";
import { surfaceTheme } from "./surface-theme.ts";
import { displayMode } from "./styles/tokens.stylex.ts";

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

export function applyDisplayMode(mode: "light" | "dark"): void {
  toggle([scheme.dark, dark], mode === "dark");
  toggle(scheme.light, mode === "light");
  document.documentElement.dataset["displayMode"] = mode;
}

export function applyTint(enabled: boolean): void {
  toggle(surfaceTheme.custom, enabled);
}
