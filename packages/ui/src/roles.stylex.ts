/**
 * Notion Calendar's colour roles over the theme layer. Each role names a light
 * and a dark theme step; `light-dark()` picks one by `color-scheme`. Hover and
 * pressed states derive from their base role, so a scope that moves the base
 * moves them too.
 *
 * `roles` holds the neutral steps the page uses. `tinted` is what a scope
 * applies with a hue: a theme class re-declares this whole group on its
 * element, so every role re-resolves from the scoped theme, and `tinted` only
 * lists the roles whose steps differ. Gray with `tinted` is a second, softer
 * gray.
 */
import { createTheme, defineVars } from "@stylexjs/stylex";
import "./theme.stylex.ts";

const step = (light: number, dark: number) =>
  `light-dark(var(--nyte-theme-${light}), var(--nyte-theme-${dark}))`;
const glass = (light: number, dark: number) =>
  `light-dark(var(--nyte-theme-translucent-${light}), var(--nyte-theme-translucent-${dark}))`;
const shade = (role: string, light: number, dark: number) =>
  `light-dark(oklch(from var(--nyte-${role}) calc(l * ${light}) c h), oklch(from var(--nyte-${role}) calc(l * ${dark}) c h))`;
const lift = (role: string, alpha: number) =>
  `oklch(from var(--nyte-${role}) l c h / calc(alpha + ${alpha}))`;

export const roles = defineVars({
  "--nyte-content-primary": step(130, 30),
  "--nyte-content-secondary": step(100, 70),
  "--nyte-content-tertiary": step(70, 100),
  "--nyte-content-disabled": step(40, 120),
  "--nyte-content-disabled-translucent": glass(40, 120),
  "--nyte-content-chrome": step(100, 60),
  "--nyte-content-interactive-primary": step(120, 20),
  "--nyte-content-interactive-secondary": step(100, 50),
  "--nyte-content-interactive-tertiary": step(80, 90),
  "--nyte-content-on-interactive-strong": "var(--nyte-theme-0)",
  "--nyte-content-on-control": "var(--nyte-theme-0)",

  "--nyte-border-primary": step(30, 120),
  "--nyte-border-secondary": step(20, 135),
  "--nyte-border-strong": step(40, 100),
  "--nyte-border-control": step(40, 100),
  "--nyte-border-interactive-primary": "var(--nyte-theme-80)",
  "--nyte-border-primary-translucent": glass(30, 120),
  "--nyte-border-secondary-translucent": glass(20, 135),
  "--nyte-border-strong-translucent": glass(40, 100),
  "--nyte-border-control-translucent": glass(40, 100),
  "--nyte-border-interactive-primary-translucent": "var(--nyte-theme-translucent-80)",

  "--nyte-bg-base": step(0, 145),
  "--nyte-bg-chrome": step(5, 150),
  "--nyte-bg-muted": step(10, 140),
  "--nyte-bg-elevated": step(0, 140),
  "--nyte-bg-inverse": step(130, 120),
  "--nyte-bg-base-translucent": glass(0, 150),
  "--nyte-bg-chrome-translucent": glass(5, 145),
  "--nyte-bg-muted-translucent": glass(10, 140),
  "--nyte-bg-scrim": "light-dark(#00000026, #000000bf)",
  "--nyte-bg-scrim-translucent": glass(40, 100),

  "--nyte-bg-interactive-primary": step(30, 120),
  "--nyte-bg-interactive-primary-hover": shade("bg-interactive-primary", 0.95, 1.05),
  "--nyte-bg-interactive-primary-pressed": shade("bg-interactive-primary", 0.88, 1.12),
  "--nyte-bg-interactive-secondary": step(15, 135),
  "--nyte-bg-interactive-secondary-hover": shade("bg-interactive-secondary", 0.95, 1.05),
  "--nyte-bg-interactive-secondary-pressed": shade("bg-interactive-secondary", 0.88, 1.12),
  "--nyte-bg-interactive-strong": step(130, 100),
  "--nyte-bg-interactive-strong-hover": shade("bg-interactive-strong", 1.2, 1.05),
  "--nyte-bg-interactive-strong-pressed": shade("bg-interactive-strong", 1.27, 1.12),
  "--nyte-bg-interactive-primary-translucent": glass(30, 120),
  "--nyte-bg-interactive-primary-translucent-hover": lift(
    "bg-interactive-primary-translucent",
    0.055,
  ),
  "--nyte-bg-interactive-primary-translucent-pressed": lift(
    "bg-interactive-primary-translucent",
    0.1,
  ),
  "--nyte-bg-interactive-secondary-translucent": glass(15, 135),
  "--nyte-bg-interactive-secondary-translucent-hover": lift(
    "bg-interactive-secondary-translucent",
    0.055,
  ),
  "--nyte-bg-interactive-secondary-translucent-pressed": lift(
    "bg-interactive-secondary-translucent",
    0.1,
  ),
  "--nyte-bg-hover": glass(15, 135),
  "--nyte-bg-pressed": lift("bg-hover", 0.045),

  "--nyte-bg-control": step(40, 100),
  "--nyte-bg-control-hover": shade("bg-control", 0.95, 1.05),
  "--nyte-bg-control-pressed": shade("bg-control", 0.88, 1.12),
  "--nyte-bg-control-selected": step(130, 100),
  "--nyte-bg-control-selected-hover": shade("bg-control-selected", 0.95, 1.05),
  "--nyte-bg-control-selected-pressed": shade("bg-control-selected", 0.88, 1.12),

  // Notion's step 80, capped in lightness so a white label reads at 4.5:1 in every hue.
  "--nyte-button-fill": "oklch(from var(--nyte-theme-80) min(l, 0.55) c h)",
  "--nyte-button-fill-hover": shade("button-fill", 0.95, 1.05),
  "--nyte-button-fill-pressed": shade("button-fill", 0.88, 1.12),

  "--nyte-sidebar-material":
    "light-dark(var(--nyte-bg-chrome), color-mix(in srgb, var(--nyte-bg-chrome) calc(36% + 64% * var(--nyte-reduce-transparency)), transparent))",
  "--nyte-popup-material":
    "light-dark(color-mix(in srgb, var(--nyte-bg-elevated) calc(80% + 20% * var(--nyte-reduce-transparency)), transparent), color-mix(in srgb, var(--nyte-bg-elevated) calc(90% + 10% * var(--nyte-reduce-transparency)), transparent))",
  "--nyte-layer-hover": "linear-gradient(var(--nyte-bg-hover), var(--nyte-bg-hover))",
  "--nyte-layer-pressed": "linear-gradient(var(--nyte-bg-pressed), var(--nyte-bg-pressed))",
  "--nyte-scrollbar-thumb": `color-mix(in srgb, ${step(70, 90)} 50%, transparent)`,
  "--nyte-conversation-user-shell-bg": "color-mix(in srgb, var(--nyte-bg-chrome) 60%, transparent)",
  "--nyte-shadow-md-outline":
    "0 8px 12px #42230308, 0 2px 6px #42230308, 0 0 0 1px light-dark(var(--nyte-border-secondary-translucent), transparent), inset 0 0 0 1px light-dark(transparent, var(--nyte-border-secondary-translucent))",
});

export const tinted = createTheme(roles, {
  "--nyte-content-primary": step(110, 30),
  "--nyte-content-tertiary": step(60, 100),
  "--nyte-content-interactive-primary": step(100, 70),
  "--nyte-content-interactive-secondary": step(100, 70),
  "--nyte-content-interactive-tertiary": step(100, 90),
  "--nyte-border-primary": step(30, 110),
  "--nyte-bg-scrim-translucent": glass(40, 130),
  "--nyte-bg-interactive-strong": "var(--nyte-theme-80)",
  "--nyte-bg-interactive-strong-hover": shade("bg-interactive-strong", 0.95, 1.05),
  "--nyte-bg-interactive-strong-pressed": shade("bg-interactive-strong", 0.88, 1.12),
  "--nyte-bg-control-selected": "var(--nyte-theme-80)",
  "--nyte-scrollbar-thumb": `color-mix(in srgb, ${step(50, 100)} 50%, transparent)`,
});
