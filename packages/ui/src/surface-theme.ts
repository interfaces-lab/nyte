/**
 * Scopes. A scope swaps the theme layer to one hue and re-declares the roles
 * from it, so everything inside reads that hue: pass `surfaceTheme.blue` or
 * `intent.danger` to `props()` on the element that starts the scope.
 *
 * Both halves are needed. A custom property inherits its computed value, so a
 * role resolved at <html> stays gray below a hue theme alone; applying a theme
 * of the roles group re-declares every role on the scoped element.
 */
import { createTheme } from "@stylexjs/stylex";

import { roles } from "./roles.stylex.ts";
import { theme } from "./theme.stylex.ts";

const steps = [
  0, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 145, 150,
];

const hue = (name: string) => ({
  ...Object.fromEntries(
    steps.map((step) => [`--nyte-theme-${step}`, `var(--nyte-${name}-${step})`]),
  ),
  ...Object.fromEntries(
    steps.map((step) => [
      `--nyte-theme-translucent-${step}`,
      `var(--nyte-translucent-${name}-${step})`,
    ]),
  ),
});

const chroma = (template: string, step: number) =>
  step === 0
    ? `var(--nyte-tpl-${template}-0)`
    : `calc(var(--nyte-tpl-${template}-${step}) * var(--nyte-custom-chroma-scale))`;

const gray = createTheme(theme, hue("gray"));
const brown = createTheme(theme, hue("brown"));
const orange = createTheme(theme, hue("orange"));
const yellow = createTheme(theme, hue("yellow"));
const green = createTheme(theme, hue("green"));
const blue = createTheme(theme, hue("blue"));
const purple = createTheme(theme, hue("purple"));
const pink = createTheme(theme, hue("pink"));
const red = createTheme(theme, hue("red"));
const teal = createTheme(theme, hue("teal"));

/**
 * The workspace tint: Notion Calendar's template ramp at the user's hue and
 * chroma. The template's translucent steps are dark ink, so dark mode rotates
 * the blue translucent ramp to the hue instead.
 */
const custom = createTheme(theme, {
  ...Object.fromEntries(
    steps.map((step) => [
      `--nyte-theme-${step}`,
      `oklch(var(--nyte-tpl-l-${step}) ${chroma("c", step)} var(--nyte-custom-hue))`,
    ]),
  ),
  ...Object.fromEntries(
    steps.map((step) => [
      `--nyte-theme-translucent-${step}`,
      `light-dark(oklch(var(--nyte-tpl-tl-${step}) calc(var(--nyte-tpl-tc-${step}) * var(--nyte-custom-chroma-scale)) var(--nyte-custom-hue) / var(--nyte-tpl-ta-${step})), oklch(from var(--nyte-translucent-blue-${step}) l calc(c * var(--nyte-custom-chroma-scale)) var(--nyte-custom-hue)))`,
    ]),
  ),
});

/**
 * The roles a scope re-declares. The control roles keep their neutral value in
 * every scope. Readable text takes the nearest step that reaches 4.5:1 on the
 * scope's base, chrome, and elevated surfaces for every hue and custom tint,
 * and interactive glyphs the nearest that reaches 3:1.
 */
const scopedRoles = createTheme(roles, {
  "--nyte-content-primary": "light-dark(var(--nyte-theme-110), var(--nyte-theme-30))",
  "--nyte-content-secondary": "light-dark(var(--nyte-theme-100), var(--nyte-theme-50))",
  "--nyte-content-tertiary": "light-dark(var(--nyte-theme-60), var(--nyte-theme-100))",
  "--nyte-content-disabled": "light-dark(var(--nyte-theme-40), var(--nyte-theme-120))",
  "--nyte-content-chrome": "light-dark(var(--nyte-theme-100), var(--nyte-theme-60))",
  "--nyte-content-interactive-primary": "light-dark(var(--nyte-theme-100), var(--nyte-theme-70))",
  "--nyte-content-disabled-translucent":
    "light-dark(var(--nyte-theme-translucent-40), var(--nyte-theme-translucent-120))",
  "--nyte-content-interactive-secondary": "light-dark(var(--nyte-theme-100), var(--nyte-theme-70))",
  "--nyte-content-interactive-tertiary": "light-dark(var(--nyte-theme-100), var(--nyte-theme-90))",
  "--nyte-content-on-interactive-strong": "light-dark(var(--nyte-theme-0), var(--nyte-theme-10))",
  "--nyte-border-primary": "light-dark(var(--nyte-theme-30), var(--nyte-theme-110))",
  "--nyte-border-secondary": "light-dark(var(--nyte-theme-20), var(--nyte-theme-135))",
  "--nyte-border-strong": "light-dark(var(--nyte-theme-40), var(--nyte-theme-100))",
  "--nyte-border-interactive-primary": "var(--nyte-theme-80)",
  "--nyte-border-primary-translucent":
    "light-dark(var(--nyte-theme-translucent-30), var(--nyte-theme-translucent-120))",
  "--nyte-border-secondary-translucent":
    "light-dark(var(--nyte-theme-translucent-20), var(--nyte-theme-translucent-135))",
  "--nyte-border-strong-translucent":
    "light-dark(var(--nyte-theme-translucent-40), var(--nyte-theme-translucent-100))",
  "--nyte-border-interactive-primary-translucent": "var(--nyte-theme-translucent-80)",
  "--nyte-bg-base": "light-dark(var(--nyte-theme-0), var(--nyte-theme-145))",
  "--nyte-bg-muted": "light-dark(var(--nyte-theme-10), var(--nyte-theme-140))",
  "--nyte-bg-elevated": "light-dark(var(--nyte-theme-0), var(--nyte-theme-140))",
  "--nyte-bg-interactive-primary": "light-dark(var(--nyte-theme-30), var(--nyte-theme-120))",
  "--nyte-bg-interactive-secondary": "light-dark(var(--nyte-theme-15), var(--nyte-theme-135))",
  "--nyte-bg-interactive-strong": "var(--nyte-theme-80)",
  "--nyte-bg-interactive-strong-hover":
    "light-dark(oklch(from var(--nyte-bg-interactive-strong) calc(l * 0.95) c h), oklch(from var(--nyte-bg-interactive-strong) calc(l * 1.05) c h))",
  "--nyte-bg-interactive-strong-pressed":
    "light-dark(oklch(from var(--nyte-bg-interactive-strong) calc(l * 0.88) c h), oklch(from var(--nyte-bg-interactive-strong) calc(l * 1.12) c h))",
  "--nyte-bg-inverse": "light-dark(var(--nyte-theme-130), var(--nyte-theme-120))",
  "--nyte-bg-control-selected": "var(--nyte-theme-80)",
  "--nyte-bg-chrome": "light-dark(var(--nyte-theme-5), var(--nyte-theme-150))",
  "--nyte-bg-base-translucent":
    "light-dark(var(--nyte-theme-translucent-0), var(--nyte-theme-translucent-150))",
  "--nyte-bg-chrome-translucent":
    "light-dark(var(--nyte-theme-translucent-5), var(--nyte-theme-translucent-145))",
  "--nyte-bg-muted-translucent":
    "light-dark(var(--nyte-theme-translucent-10), var(--nyte-theme-translucent-140))",
  "--nyte-bg-interactive-primary-translucent":
    "light-dark(var(--nyte-theme-translucent-30), var(--nyte-theme-translucent-120))",
  "--nyte-bg-interactive-secondary-translucent":
    "light-dark(var(--nyte-theme-translucent-15), var(--nyte-theme-translucent-135))",
  "--nyte-bg-scrim-translucent":
    "light-dark(var(--nyte-theme-translucent-40), var(--nyte-theme-translucent-130))",
  "--nyte-scrollbar-thumb":
    "color-mix(in srgb, light-dark(var(--nyte-theme-50), var(--nyte-theme-100)) 50%, transparent)",
});

/** Each hue as a scope. `custom` is the workspace tint `boot.ts` puts on <html>. */
export const surfaceTheme = {
  gray: [gray, scopedRoles],
  brown: [brown, scopedRoles],
  orange: [orange, scopedRoles],
  yellow: [yellow, scopedRoles],
  green: [green, scopedRoles],
  blue: [blue, scopedRoles],
  purple: [purple, scopedRoles],
  pink: [pink, scopedRoles],
  red: [red, scopedRoles],
  teal: [teal, scopedRoles],
  custom: [custom, scopedRoles],
} as const;

export type Tint = keyof typeof surfaceTheme;

/** Notion Calendar's intents, as scopes: what a control means picks its hue. */
export const intent = {
  primary: surfaceTheme.blue,
  success: surfaceTheme.green,
  warning: surfaceTheme.yellow,
  danger: surfaceTheme.red,
} as const;
