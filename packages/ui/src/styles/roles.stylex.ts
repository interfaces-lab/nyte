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

/** Accent text also sits on neutral pressed fills, outside its own hue's surfaces. */
const ink =
  "light-dark(oklch(from var(--nyte-theme-100) min(l, 0.45) c h), oklch(from var(--nyte-theme-80) max(l, 0.85) c h))";

/** The clamp holds the step's contrast floor in every hue, whose ramps differ in lightness. */
const stair = (light: number, lightCeiling: number, dark: number, darkFloor: number) =>
  `light-dark(oklch(from var(--nyte-theme-${light}) min(l, ${lightCeiling}) c h), oklch(from var(--nyte-theme-${dark}) max(l, ${darkFloor}) c h))`;

const contrast = <Value extends string>(normal: Value, more: Value) => ({
  default: normal,
  "@media (prefers-contrast: more)": more,
});

const tint = (color: string, strength: string) =>
  `color-mix(in srgb, ${color}, hsl(from ${color} var(--nyte-custom-hue) 100 l) calc(${strength} * var(--nyte-custom-chroma-scale)))`;

const hover = (role: string) => contrast(shade(role, 0.95, 1.05), shade(role, 0.7, 1.3));

const press = (role: string) => contrast(shade(role, 0.88, 1.12), shade(role, 0.5, 1.4));

export const roles = defineVars({
  "--nyte-content-primary": contrast(stair(130, 0.3, 20, 0.94), step(140, 0)),
  "--nyte-content-secondary": contrast(stair(110, 0.43, 50, 0.78), step(120, 30)),
  "--nyte-content-tertiary": contrast(stair(90, 0.5, 70, 0.69), step(110, 50)),
  "--nyte-content-quaternary": contrast(stair(80, 0.6, 90, 0.57), step(100, 70)),
  "--nyte-content-disabled": contrast(step(50, 100), step(70, 90)),
  /** The scope's hue as ink: error and attention text, status dots, accent strokes. */
  "--nyte-content-accent": contrast(ink, stair(100, 0.38, 40, 0.85)),
  "--nyte-content-on-interactive-strong": "var(--nyte-theme-0)",
  "--nyte-content-on-control": "var(--nyte-neutral-0)",

  /** Opaque, so a control's edge keeps 3:1 over its own hover fill. */
  "--nyte-stroke-primary": control(100, 80),
  "--nyte-stroke-secondary": contrast(glass(40, 100), glass(50, 100)),
  "--nyte-stroke-tertiary": contrast(glass(30, 120), glass(40, 110)),
  "--nyte-stroke-quaternary": contrast(glass(20, 135), glass(30, 120)),
  "--nyte-stroke-accent": "var(--nyte-theme-80)",

  "--nyte-bg-base": step(0, 145),
  "--nyte-bg-chrome": step(5, 150),
  "--nyte-bg-muted": step(10, 140),
  "--nyte-bg-elevated": step(0, 140),
  "--nyte-bg-muted-translucent": glass(10, 140),
  "--nyte-bg-scrim": "light-dark(#00000026, #000000bf)",
  "--nyte-bg-scrim-translucent": glass(40, 100),

  "--nyte-bg-interactive-strong": step(130, 100),

  "--nyte-fill-primary": contrast(glass(40, 120), glass(50, 110)),
  "--nyte-fill-secondary": contrast(glass(20, 130), glass(40, 120)),
  "--nyte-fill-tertiary": contrast(glass(15, 135), glass(30, 130)),

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
  "--nyte-layer-hover": "linear-gradient(var(--nyte-fill-tertiary), var(--nyte-fill-tertiary))",
  "--nyte-layer-pressed": "linear-gradient(var(--nyte-fill-secondary), var(--nyte-fill-secondary))",
  "--nyte-scrollbar-thumb": `color-mix(in srgb, ${step(70, 90)} 50%, transparent)`,
  "--nyte-conversation-user-shell-bg": "color-mix(in srgb, var(--nyte-bg-chrome) 60%, transparent)",
  "--nyte-shadow-md-outline":
    "0 8px 12px light-dark(#42230308, #42230310), 0 2px 6px light-dark(#42230308, #42230310), 0 0 0 1px light-dark(var(--nyte-stroke-quaternary), transparent), inset 0 0 0 1px light-dark(transparent, var(--nyte-stroke-quaternary))",
});

const hued = {
  "--nyte-content-accent": contrast(ink, stair(100, 0.38, 60, 0.85)),
  "--nyte-bg-scrim-translucent": glass(40, 130),
  "--nyte-bg-interactive-strong": "var(--nyte-theme-80)",
  /** Capped so a white glyph on a light hue (yellow, teal) keeps 3:1. */
  "--nyte-bg-control-selected": "oklch(from var(--nyte-theme-80) min(l, 0.62) c h)",
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
