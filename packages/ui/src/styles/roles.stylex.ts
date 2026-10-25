import { createTheme, defineVars } from "@stylexjs/stylex";
import "./theme.stylex.ts";

const step = (light: number, dark: number) =>
  `light-dark(var(--nyte-theme-${light}), var(--nyte-theme-${dark}))`;

const control = (light: number, dark: number) =>
  `light-dark(var(--nyte-neutral-${light}), var(--nyte-neutral-${dark}))`;

const glass = (light: number, dark: number) =>
  `light-dark(var(--nyte-theme-translucent-${light}), var(--nyte-theme-translucent-${dark}))`;

const shade = (role: string, light: number, dark: number) =>
  `light-dark(oklch(from var(--nyte-${role}) calc(l * ${light}) c h), oklch(from var(--nyte-${role}) calc(l * ${dark}) c h))`;

const lift = (role: string, alpha: number) =>
  `oklch(from var(--nyte-${role}) l c h / calc(alpha + ${alpha}))`;

/** The OS "increase contrast" setting; the values follow Notion's high-contrast mode. */
const contrast = <Value extends string>(normal: Value, more: Value) => ({
  default: normal,
  "@media (prefers-contrast: more)": more,
});

const tint = (color: string, strength: string) =>
  `color-mix(in srgb, ${color}, hsl(from ${color} var(--nyte-custom-hue) 100 l) calc(${strength} * var(--nyte-custom-chroma-scale)))`;

const hover = (role: string) => contrast(shade(role, 0.95, 1.05), shade(role, 0.7, 1.3));

const press = (role: string) => contrast(shade(role, 0.88, 1.12), shade(role, 0.5, 1.4));

export const roles = defineVars({
  "--nyte-content-primary": contrast(step(130, 30), step(140, 10)),
  "--nyte-content-secondary": contrast(step(100, 70), step(110, 30)),
  "--nyte-content-tertiary": contrast(step(70, 100), step(110, 30)),
  "--nyte-content-disabled": contrast(step(40, 120), step(60, 100)),
  "--nyte-content-chrome": contrast(step(100, 60), step(110, 30)),
  "--nyte-content-interactive-primary": contrast(step(120, 20), step(140, 20)),
  "--nyte-content-interactive-secondary": contrast(step(100, 50), step(100, 40)),
  "--nyte-content-interactive-tertiary": contrast(step(80, 90), step(100, 40)),
  "--nyte-content-on-interactive-strong": "var(--nyte-theme-0)",
  "--nyte-content-on-control": "var(--nyte-neutral-0)",

  "--nyte-border-primary": step(30, 120),
  "--nyte-border-secondary": step(20, 135),
  "--nyte-border-strong": step(40, 100),
  "--nyte-border-control": control(80, 80),
  "--nyte-border-interactive-primary": "var(--nyte-theme-80)",
  "--nyte-border-primary-translucent": glass(30, 120),
  "--nyte-border-secondary-translucent": glass(20, 135),
  "--nyte-border-strong-translucent": glass(40, 100),
  "--nyte-border-control-translucent":
    "light-dark(var(--nyte-neutral-translucent-80), var(--nyte-neutral-translucent-80))",

  "--nyte-bg-base": step(0, 145),
  "--nyte-bg-chrome": step(5, 150),
  "--nyte-bg-muted": step(10, 140),
  "--nyte-bg-elevated": step(0, 140),
  "--nyte-bg-muted-translucent": glass(10, 140),
  "--nyte-bg-scrim": "light-dark(#00000026, #000000bf)",
  "--nyte-bg-scrim-translucent": glass(40, 100),

  "--nyte-bg-interactive-primary": step(30, 120),
  "--nyte-bg-interactive-primary-pressed": press("bg-interactive-primary"),
  "--nyte-bg-interactive-secondary": step(15, 135),
  "--nyte-bg-interactive-secondary-hover": hover("bg-interactive-secondary"),
  "--nyte-bg-interactive-secondary-pressed": press("bg-interactive-secondary"),
  "--nyte-bg-interactive-strong": step(130, 100),
  "--nyte-bg-interactive-primary-translucent": glass(30, 120),
  "--nyte-bg-interactive-secondary-translucent": glass(15, 135),
  "--nyte-bg-hover": contrast(glass(15, 135), lift("bg-interactive-secondary-translucent", 0.2)),
  "--nyte-bg-pressed": contrast(lift("bg-hover", 0.045), lift("bg-hover", 0.1)),

  "--nyte-bg-control": control(80, 100),
  "--nyte-bg-control-hover": hover("bg-control"),
  "--nyte-bg-control-pressed": press("bg-control"),
  "--nyte-bg-control-selected": step(130, 100),
  "--nyte-bg-control-selected-hover": hover("bg-control-selected"),
  "--nyte-bg-control-selected-pressed": press("bg-control-selected"),

  "--nyte-chart-series": "var(--nyte-theme-90)",
  "--nyte-button-fill": "oklch(from var(--nyte-theme-80) min(l, 0.52) c h)",
  "--nyte-button-fill-hover": shade("button-fill", 0.95, 0.95),
  "--nyte-button-fill-pressed": shade("button-fill", 0.88, 0.88),

  "--nyte-window-wash":
    "color-mix(in srgb, var(--nyte-bg-chrome) calc(100% * var(--nyte-reduce-transparency)), light-dark(#ffffff29, #0000006b))",
  "--nyte-sidebar-material":
    "light-dark(color-mix(in srgb, var(--nyte-bg-chrome) calc(42% + 58% * var(--nyte-reduce-transparency)), transparent), color-mix(in srgb, var(--nyte-bg-chrome) calc(36% + 64% * var(--nyte-reduce-transparency)), transparent))",
  "--nyte-surface-material":
    "light-dark(color-mix(in srgb, var(--nyte-bg-base) calc(84% + 16% * var(--nyte-reduce-transparency)), transparent), color-mix(in srgb, var(--nyte-bg-base) calc(72% + 28% * var(--nyte-reduce-transparency)), transparent))",
  "--nyte-popup-material":
    "light-dark(color-mix(in srgb, var(--nyte-bg-elevated) calc(80% + 20% * var(--nyte-reduce-transparency)), transparent), color-mix(in srgb, var(--nyte-bg-elevated) calc(90% + 10% * var(--nyte-reduce-transparency)), transparent))",
  "--nyte-layer-hover": "linear-gradient(var(--nyte-bg-hover), var(--nyte-bg-hover))",
  "--nyte-layer-pressed": "linear-gradient(var(--nyte-bg-pressed), var(--nyte-bg-pressed))",
  "--nyte-scrollbar-thumb": `color-mix(in srgb, ${step(70, 90)} 50%, transparent)`,
  "--nyte-conversation-user-shell-bg": "color-mix(in srgb, var(--nyte-bg-chrome) 60%, transparent)",
  "--nyte-shadow-md-outline":
    "0 8px 12px light-dark(#42230308, #42230310), 0 2px 6px light-dark(#42230308, #42230310), 0 0 0 1px light-dark(var(--nyte-border-secondary-translucent), transparent), inset 0 0 0 1px light-dark(transparent, var(--nyte-border-secondary-translucent))",
});

const hued = {
  "--nyte-content-primary": contrast(step(110, 30), step(140, 10)),
  "--nyte-content-tertiary": contrast(step(60, 100), step(110, 30)),
  "--nyte-content-interactive-primary": contrast(step(100, 70), step(100, 40)),
  "--nyte-content-interactive-secondary": contrast(step(100, 70), step(100, 60)),
  "--nyte-content-interactive-tertiary": contrast(step(100, 90), step(100, 60)),
  "--nyte-border-primary": step(30, 110),
  "--nyte-bg-scrim-translucent": glass(40, 130),
  "--nyte-bg-interactive-strong": "var(--nyte-theme-80)",
  "--nyte-bg-control-selected": "var(--nyte-theme-80)",
  "--nyte-scrollbar-thumb": `color-mix(in srgb, ${step(50, 100)} 50%, transparent)`,
};

export const tinted = createTheme(roles, hued);

export const surfaceTint = createTheme(roles, {
  "--nyte-bg-base": tint(step(0, 145), "50%"),
  "--nyte-bg-chrome": tint(step(5, 150), "100%"),
  "--nyte-bg-muted": tint(step(10, 140), "50%"),
  "--nyte-bg-elevated": tint(step(0, 140), "50%"),
});

/** The primary intent: its solid fill is the hue itself, not darkened for a text label. */
export const accent = createTheme(roles, {
  ...hued,
  "--nyte-button-fill": "var(--nyte-theme-80)",
});
