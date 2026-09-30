/**
 * The design tokens, keyed by the custom property each compiles to. Plain
 * CSS, the terminal, and the desktop startup shell read a token by that name;
 * StyleX code takes the typed handles in `vars.stylex.ts` and
 * `schema.stylex.ts`.
 *
 * Colour comes in layers: `ramps.stylex.ts` holds Notion Calendar's hues,
 * `theme.stylex.ts` picks one of them for a scope, and `roles.stylex.ts` names
 * what each step paints. Importing this file ships all of them. The groups here
 * never change inside a scope: the appearance inputs `boot.ts` and
 * `appearance.css` write on <html>, the colours that must not follow a tint,
 * shadows, type, motion, and geometry.
 */
import { defineVars } from "@stylexjs/stylex";

import "./ramps.stylex.ts";
import "./theme.stylex.ts";
import "./roles.stylex.ts";

/** Written on <html> by the desktop's `boot.ts` and overridden in its `appearance.css`. */
export const appearance = defineVars({
  // The workspace tint: an OKLCH hue, and a scale on the template's chroma.
  "--nyte-custom-hue": "250",
  "--nyte-custom-chroma-scale": "1",
  // 1 makes the materials opaque.
  "--nyte-reduce-transparency": "0",
  "--nyte-popup-material-filter": "blur(12px)",
  // `appearance.css` sets this to `default` unless the user opts into pointer cursors.
  "--nyte-cursor-interactive": "pointer",
  // `appearance.css` clears this while focus arrives by pointer.
  "--nyte-focus-ring": "var(--nyte-blue-80)",
});

/**
 * Colours that keep their hue under every tint and scope. Status text takes
 * the step of its hue that reads at 4.5:1 on the page in each mode.
 */
export const colors = defineVars({
  "--nyte-intent-primary-content": "light-dark(var(--nyte-blue-100), var(--nyte-blue-70))",
  "--nyte-intent-success-content": "light-dark(var(--nyte-green-100), var(--nyte-green-70))",
  "--nyte-intent-warning-content": "light-dark(var(--nyte-yellow-100), var(--nyte-yellow-70))",
  "--nyte-intent-danger-content": "light-dark(var(--nyte-red-100), var(--nyte-red-70))",
  // The primary intent's filled control, for hosts that paint it outside a scope.
  // White and its step 10 both read at 4.5:1 on it.
  "--nyte-intent-primary-fill": "var(--nyte-blue-100)",
  "--nyte-intent-primary-bg":
    "light-dark(var(--nyte-translucent-blue-15), var(--nyte-translucent-blue-135))",
  "--nyte-intent-success-bg":
    "light-dark(var(--nyte-translucent-green-15), var(--nyte-translucent-green-135))",
  "--nyte-intent-warning-bg":
    "light-dark(var(--nyte-translucent-yellow-15), var(--nyte-translucent-yellow-135))",
  "--nyte-intent-danger-bg":
    "light-dark(var(--nyte-translucent-red-15), var(--nyte-translucent-red-135))",
  // Code: one role per kind of token, each at the step of its hue that reads at
  // 4.5:1 on the page in both modes.
  "--nyte-syntax-keyword": "light-dark(var(--nyte-purple-100), var(--nyte-purple-70))",
  "--nyte-syntax-string": "light-dark(var(--nyte-green-100), var(--nyte-green-70))",
  "--nyte-syntax-identifier": "light-dark(var(--nyte-blue-100), var(--nyte-blue-70))",
  "--nyte-syntax-constant": "light-dark(var(--nyte-teal-100), var(--nyte-teal-70))",
  "--nyte-syntax-variable": "light-dark(var(--nyte-orange-100), var(--nyte-orange-70))",
  // Glyphs and dots in the hues whose saturated step falls under 3:1 on a light page.
  "--nyte-mark-orange": "light-dark(var(--nyte-orange-90), var(--nyte-orange-80))",
  "--nyte-mark-yellow": "light-dark(var(--nyte-yellow-100), var(--nyte-yellow-80))",
  "--nyte-mark-teal": "light-dark(var(--nyte-teal-90), var(--nyte-teal-80))",
  // Selected text, in the page and in the terminal.
  "--nyte-selection":
    "light-dark(var(--nyte-translucent-blue-30), var(--nyte-translucent-blue-120))",
  // Behind image transparency, which must not pick up the workspace tint.
  "--nyte-image-bg": "light-dark(var(--nyte-gray-0), var(--nyte-gray-145))",
  // The custom hue's saturated step, for the appearance swatch.
  "--nyte-tint-swatch":
    "oklch(var(--nyte-tpl-l-80) calc(var(--nyte-tpl-c-80) * var(--nyte-custom-chroma-scale)) var(--nyte-custom-hue))",
  // A diff line takes its intent's secondary wash, a changed word the primary one.
  "--nyte-diff-added-line-bg":
    "light-dark(var(--nyte-translucent-green-15), var(--nyte-translucent-green-135))",
  "--nyte-diff-added-text-bg":
    "light-dark(var(--nyte-translucent-green-30), var(--nyte-translucent-green-120))",
  "--nyte-diff-removed-line-bg":
    "light-dark(var(--nyte-translucent-red-15), var(--nyte-translucent-red-135))",
  "--nyte-diff-removed-text-bg":
    "light-dark(var(--nyte-translucent-red-30), var(--nyte-translucent-red-120))",
});

/** Notion Calendar's shadows, and the workbench edge. The outlined one reads a role, so it lives in `roles.stylex.ts`. */
export const elevation = defineVars({
  "--nyte-shadow-sm": "0px 4px 12px 0px #42230308, 0px 1px 2px 0px #42230308",
  "--nyte-shadow-md": "0px 8px 12px 0px #42230308, 0px 2px 6px 0px #42230308",
  "--nyte-shadow-lg": "0px 20px 24px 0px #2a1c0012, 0px 5px 8px 0px #42230308",
  "--nyte-shadow-xl": "0px 24px 72px -24px #1b150030, 0px 8px 32px 0px #2a1c0012",
  // Nyte's own: the workbench panel docks against the window edge, so its shadow
  // glows on every side rather than falling below.
  "--nyte-shadow-workbench": "0 0 8px 2px #00000014",
});

/**
 * The desktop's `boot.ts` writes the family and size inputs inline on <html>
 * before first paint; the scale derives from them here. Inter and JetBrains
 * Mono ship with the app, `system-ui` and `ui-monospace` are whatever the OS
 * has.
 */
export const typography = defineVars({
  "--nyte-ui-font-inter": '"Inter Variable", system-ui, sans-serif',
  "--nyte-ui-font-system": "system-ui, sans-serif",
  "--nyte-code-font-jetbrains-mono": '"JetBrains Mono Variable", ui-monospace, monospace',
  "--nyte-code-font-system":
    'ui-monospace, Menlo, "DejaVu Sans Mono", "Liberation Mono", Consolas, monospace',
  "--nyte-font-family-sans": "var(--nyte-ui-font-inter)",
  "--nyte-font-family-mono": "var(--nyte-code-font-system)",
  "--nyte-font-size-base": "13px",
  "--nyte-font-size-code": "12px",
  "--nyte-font-size-xs": "max(11px, calc(var(--nyte-font-size-base) - 2px))",
  "--nyte-font-size-sm": "calc(var(--nyte-font-size-base) - 1px)",
  // Chat, composer, and bubbles set 15px type on 13px chrome.
  "--nyte-font-size-lg": "calc(var(--nyte-font-size-base) + 2px)",
  "--nyte-font-size-2xl": "calc(var(--nyte-font-size-base) + 6px)",
  "--nyte-line-height-xs": "calc(var(--nyte-font-size-base) + 1px)",
  "--nyte-line-height-sm": "calc(var(--nyte-font-size-base) + 3px)",
  "--nyte-line-height-base": "calc(var(--nyte-font-size-base) + 5px)",
  "--nyte-line-height-lg": "calc(var(--nyte-font-size-base) + 11px)",
  "--nyte-letter-spacing-base": "0px",
  "--nyte-letter-spacing-lg": "-0.24px",
});

export const motion = defineVars({
  "--nyte-duration-instant": "50ms",
  "--nyte-duration-fast": "100ms",
  "--nyte-duration-normal": "150ms",
  "--nyte-duration-slow": "200ms",
  "--nyte-easing-out": "ease-out",
  "--nyte-easing-out-quint": "cubic-bezier(0.16, 1, 0.3, 1)",
  "--nyte-easing-in-out-strong": "cubic-bezier(0.77, 0, 0.175, 1)",
});

/** Notion Calendar's size primitives. Component tokens and the radius handles build on them. */
export const sizes = defineVars({
  "--nyte-spacing": "1px",
  "--nyte-spacing-0": "0px",
  "--nyte-spacing-2": "2px",
  "--nyte-spacing-4": "4px",
  "--nyte-spacing-6": "6px",
  "--nyte-spacing-8": "8px",
  "--nyte-spacing-10": "10px",
  "--nyte-spacing-12": "12px",
  "--nyte-spacing-14": "14px",
  "--nyte-spacing-16": "16px",
  "--nyte-spacing-20": "20px",
  "--nyte-spacing-22": "22px",
  "--nyte-spacing-24": "24px",
  "--nyte-spacing-28": "28px",
  "--nyte-spacing-30": "30px",
  "--nyte-spacing-32": "32px",
  "--nyte-spacing-36": "36px",
  "--nyte-spacing-40": "40px",
  "--nyte-spacing-44": "44px",
  "--nyte-spacing-48": "48px",
  "--nyte-spacing-52": "52px",
  "--nyte-spacing-56": "56px",
  "--nyte-spacing-64": "64px",
  "--nyte-spacing-72": "72px",
  "--nyte-spacing-80": "80px",
  "--nyte-spacing-96": "96px",
  "--nyte-sizing-full": "100%",
  "--nyte-sizing-0": "0px",
  "--nyte-sizing-2": "2px",
  "--nyte-sizing-4": "4px",
  "--nyte-sizing-6": "6px",
  "--nyte-sizing-8": "8px",
  "--nyte-sizing-10": "10px",
  "--nyte-sizing-12": "12px",
  "--nyte-sizing-14": "14px",
  "--nyte-sizing-16": "16px",
  "--nyte-sizing-20": "20px",
  "--nyte-sizing-22": "22px",
  "--nyte-sizing-24": "24px",
  "--nyte-sizing-28": "28px",
  "--nyte-sizing-30": "30px",
  "--nyte-sizing-32": "32px",
  "--nyte-sizing-36": "36px",
  "--nyte-sizing-40": "40px",
  "--nyte-sizing-44": "44px",
  "--nyte-sizing-48": "48px",
  "--nyte-sizing-52": "52px",
  "--nyte-sizing-56": "56px",
  "--nyte-sizing-64": "64px",
  "--nyte-sizing-72": "72px",
  "--nyte-sizing-80": "80px",
  "--nyte-sizing-96": "96px",
  "--nyte-sizing-120": "120px",
  "--nyte-sizing-140": "140px",
  "--nyte-sizing-160": "160px",
  "--nyte-sizing-180": "180px",
  "--nyte-sizing-200": "200px",
  "--nyte-sizing-240": "240px",
  "--nyte-sizing-280": "280px",
  "--nyte-sizing-320": "320px",
  "--nyte-sizing-360": "360px",
  "--nyte-sizing-400": "400px",
  "--nyte-sizing-480": "480px",
  "--nyte-sizing-560": "560px",
  "--nyte-sizing-640": "640px",
  "--nyte-sizing-720": "720px",
  "--nyte-sizing-960": "960px",
  "--nyte-sizing-1080": "1080px",
  "--nyte-sizing-1280": "1280px",
  "--nyte-radius-0": "0px",
  "--nyte-radius-2": "2px",
  "--nyte-radius-4": "4px",
  "--nyte-radius-6": "6px",
  "--nyte-radius-8": "8px",
  "--nyte-radius-10": "10px",
  "--nyte-radius-12": "12px",
  "--nyte-radius-14": "14px",
  "--nyte-radius-16": "16px",
  "--nyte-radius-20": "20px",
  "--nyte-radius-24": "24px",
  "--nyte-radius-full": "9999px",
});

/**
 * Component measurements over the size primitives. A coarse pointer gets
 * the larger box Notion Calendar gives touch.
 */
export const components = defineVars({
  "--nyte-btn-height-2xs": {
    default: "var(--nyte-sizing-16)",
    "@media (pointer: coarse)": "var(--nyte-sizing-28)",
  },
  "--nyte-btn-padding-inline-2xs": {
    default: "var(--nyte-spacing-4)",
    "@media (pointer: coarse)": "var(--nyte-spacing-8)",
  },
  "--nyte-btn-pill-padding-inline-2xs": {
    default: "var(--nyte-spacing-6)",
    "@media (pointer: coarse)": "var(--nyte-spacing-10)",
  },
  "--nyte-btn-radius-2xs": {
    default: "var(--nyte-radius-4)",
    "@media (pointer: coarse)": "var(--nyte-radius-8)",
  },
  "--nyte-btn-gap-2xs": {
    default: "var(--nyte-spacing-4)",
    "@media (pointer: coarse)": "var(--nyte-spacing-6)",
  },
  "--nyte-btn-height-xs": {
    default: "var(--nyte-sizing-20)",
    "@media (pointer: coarse)": "var(--nyte-sizing-32)",
  },
  "--nyte-btn-padding-inline-xs": {
    default: "var(--nyte-spacing-6)",
    "@media (pointer: coarse)": "var(--nyte-spacing-10)",
  },
  "--nyte-btn-pill-padding-inline-xs": {
    default: "var(--nyte-spacing-6)",
    "@media (pointer: coarse)": "var(--nyte-spacing-12)",
  },
  "--nyte-btn-radius-xs": {
    default: "var(--nyte-radius-4)",
    "@media (pointer: coarse)": "var(--nyte-radius-10)",
  },
  "--nyte-btn-gap-xs": {
    default: "var(--nyte-spacing-4)",
    "@media (pointer: coarse)": "var(--nyte-spacing-8)",
  },
  "--nyte-btn-height-sm": {
    default: "var(--nyte-sizing-24)",
    "@media (pointer: coarse)": "var(--nyte-sizing-36)",
  },
  "--nyte-btn-padding-inline-sm": {
    default: "var(--nyte-spacing-8)",
    "@media (pointer: coarse)": "var(--nyte-spacing-10)",
  },
  "--nyte-btn-pill-padding-inline-sm": {
    default: "var(--nyte-spacing-10)",
    "@media (pointer: coarse)": "var(--nyte-spacing-16)",
  },
  "--nyte-btn-radius-sm": {
    default: "var(--nyte-radius-6)",
    "@media (pointer: coarse)": "var(--nyte-radius-12)",
  },
  "--nyte-btn-gap-sm": {
    default: "var(--nyte-spacing-6)",
    "@media (pointer: coarse)": "var(--nyte-spacing-8)",
  },
  "--nyte-btn-height-md": {
    default: "var(--nyte-sizing-28)",
    "@media (pointer: coarse)": "var(--nyte-sizing-40)",
  },
  "--nyte-btn-padding-inline-md": {
    default: "var(--nyte-spacing-8)",
    "@media (pointer: coarse)": "var(--nyte-spacing-12)",
  },
  "--nyte-btn-pill-padding-inline-md": {
    default: "var(--nyte-spacing-10)",
    "@media (pointer: coarse)": "var(--nyte-spacing-16)",
  },
  "--nyte-btn-radius-md": {
    default: "var(--nyte-radius-8)",
    "@media (pointer: coarse)": "var(--nyte-radius-12)",
  },
  "--nyte-btn-gap-md": {
    default: "var(--nyte-spacing-6)",
    "@media (pointer: coarse)": "var(--nyte-spacing-10)",
  },
  "--nyte-btn-height-lg": {
    default: "var(--nyte-sizing-32)",
    "@media (pointer: coarse)": "var(--nyte-sizing-44)",
  },
  "--nyte-btn-padding-inline-lg": {
    default: "var(--nyte-spacing-10)",
    "@media (pointer: coarse)": "var(--nyte-spacing-14)",
  },
  "--nyte-btn-pill-padding-inline-lg": {
    default: "var(--nyte-spacing-12)",
    "@media (pointer: coarse)": "var(--nyte-spacing-16)",
  },
  "--nyte-btn-radius-lg": {
    default: "var(--nyte-radius-8)",
    "@media (pointer: coarse)": "var(--nyte-radius-14)",
  },
  "--nyte-btn-gap-lg": {
    default: "var(--nyte-spacing-8)",
    "@media (pointer: coarse)": "var(--nyte-spacing-10)",
  },
  "--nyte-btn-height-xl": {
    default: "var(--nyte-sizing-36)",
    "@media (pointer: coarse)": "var(--nyte-sizing-48)",
  },
  "--nyte-btn-padding-inline-xl": {
    default: "var(--nyte-spacing-12)",
    "@media (pointer: coarse)": "var(--nyte-spacing-16)",
  },
  "--nyte-btn-pill-padding-inline-xl": {
    default: "var(--nyte-spacing-12)",
    "@media (pointer: coarse)": "var(--nyte-spacing-20)",
  },
  "--nyte-btn-radius-xl": {
    default: "var(--nyte-radius-10)",
    "@media (pointer: coarse)": "var(--nyte-radius-16)",
  },
  "--nyte-btn-gap-xl": {
    default: "var(--nyte-spacing-8)",
    "@media (pointer: coarse)": "var(--nyte-spacing-12)",
  },
  "--nyte-icon-btn-padding-inline": "var(--nyte-spacing-4)",
  "--nyte-input-height-md": {
    default: "var(--nyte-sizing-28)",
    "@media (pointer: coarse)": "var(--nyte-sizing-40)",
  },
  "--nyte-input-inset-md": "var(--nyte-spacing-4)",
  "--nyte-input-padding-end-md": "calc(var(--nyte-input-inset-md) + var(--nyte-spacing-2))",
  "--nyte-input-textarea-min-height-md": {
    default: "var(--nyte-sizing-48)",
    "@media (pointer: coarse)": "calc(var(--nyte-sizing-72) - var(--nyte-spacing-2))",
  },
  "--nyte-input-textarea-padding-block-md": {
    default: "var(--nyte-input-inset-md)",
    "@media (pointer: coarse)": "calc(var(--nyte-spacing-8) + var(--nyte-spacing))",
  },
  "--nyte-input-radius-md": {
    default: "var(--nyte-radius-8)",
    "@media (pointer: coarse)": "var(--nyte-radius-12)",
  },
  "--nyte-input-height-lg": {
    default: "var(--nyte-sizing-32)",
    "@media (pointer: coarse)": "var(--nyte-sizing-44)",
  },
  "--nyte-input-inset-lg": "var(--nyte-spacing-6)",
  "--nyte-input-padding-end-lg": "calc(var(--nyte-input-inset-lg) + var(--nyte-spacing-2))",
  "--nyte-input-textarea-min-height-lg": {
    default: "var(--nyte-sizing-52)",
    "@media (pointer: coarse)": "var(--nyte-sizing-72)",
  },
  "--nyte-input-textarea-padding-block-lg": {
    default: "var(--nyte-input-inset-lg)",
    "@media (pointer: coarse)": "var(--nyte-spacing-10)",
  },
  "--nyte-input-radius-lg": {
    default: "var(--nyte-radius-8)",
    "@media (pointer: coarse)": "var(--nyte-radius-14)",
  },
  "--nyte-input-height-xl": {
    default: "var(--nyte-sizing-36)",
    "@media (pointer: coarse)": "var(--nyte-sizing-48)",
  },
  "--nyte-input-inset-xl": "var(--nyte-spacing-8)",
  "--nyte-input-padding-end-xl": "calc(var(--nyte-input-inset-xl) + var(--nyte-spacing-2))",
  "--nyte-input-textarea-min-height-xl": {
    default: "var(--nyte-sizing-56)",
    "@media (pointer: coarse)": "calc(var(--nyte-sizing-72) + var(--nyte-spacing-4))",
  },
  "--nyte-input-textarea-padding-block-xl": {
    default: "var(--nyte-input-inset-xl)",
    "@media (pointer: coarse)": "var(--nyte-spacing-12)",
  },
  "--nyte-input-radius-xl": {
    default: "var(--nyte-radius-10)",
    "@media (pointer: coarse)": "var(--nyte-radius-16)",
  },
  "--nyte-switch-width-md": { default: "28px", "@media (pointer: coarse)": "48px" },
  "--nyte-switch-height-md": { default: "16px", "@media (pointer: coarse)": "28px" },
  "--nyte-switch-padding-md": { default: "2px", "@media (pointer: coarse)": "3px" },
  "--nyte-switch-knob-md": { default: "12px", "@media (pointer: coarse)": "22px" },
  "--nyte-switch-width-sm": { default: "20px", "@media (pointer: coarse)": "48px" },
  "--nyte-switch-height-sm": { default: "12px", "@media (pointer: coarse)": "28px" },
  "--nyte-switch-padding-sm": { default: "2px", "@media (pointer: coarse)": "3px" },
  "--nyte-switch-knob-sm": { default: "8px", "@media (pointer: coarse)": "22px" },
  "--nyte-checkbox-size-md": {
    default: "var(--nyte-sizing-16)",
    "@media (pointer: coarse)": "var(--nyte-sizing-20)",
  },
  "--nyte-checkbox-size-lg": "var(--nyte-sizing-20)",
  "--nyte-checkbox-radius": "var(--nyte-radius-4)",
  "--nyte-row-height-md": {
    default: "var(--nyte-sizing-28)",
    "@media (pointer: coarse)": "var(--nyte-sizing-44)",
  },
  "--nyte-row-height-lg": {
    default: "var(--nyte-sizing-32)",
    "@media (pointer: coarse)": "var(--nyte-sizing-44)",
  },
  "--nyte-row-padding-inline-md": "var(--nyte-spacing-4)",
  "--nyte-row-padding-inline-lg": "var(--nyte-spacing-6)",
  "--nyte-row-gap": "var(--nyte-spacing-6)",
  "--nyte-row-radius": "var(--nyte-radius-8)",
});

/** Nyte's own component measurements, named at their handles in `schema.stylex.ts`. */
export const geometry = defineVars({
  "--nyte-glyph-box": "15px",
  "--nyte-menu-item-height": "var(--nyte-row-height-md)",
  "--nyte-menu-padding": "var(--nyte-spacing-6)",
  "--nyte-menu-radius": "var(--nyte-radius-14)",
  "--nyte-menu-item-radius": "var(--nyte-row-radius)",
  "--nyte-menu-item-gap": "var(--nyte-row-gap)",
  "--nyte-menu-item-padding-inline": "var(--nyte-row-padding-inline-md)",
  "--nyte-menu-item-padding-block":
    "calc((var(--nyte-menu-item-height) - var(--nyte-line-height-base)) / 2)",
  "--nyte-menu-width": "var(--nyte-sizing-200)",
  "--nyte-model-menu-width": "230px",
  "--nyte-parameter-menu-width": "220px",
  "--nyte-menu-max-height": "min(var(--nyte-sizing-320), calc(100vh - var(--nyte-spacing-32)))",
  "--nyte-dialog-width": "var(--nyte-sizing-400)",
  "--nyte-dialog-padding": "var(--nyte-spacing-24)",
  "--nyte-dialog-gap": "var(--nyte-spacing-16)",
  "--nyte-dialog-radius": "var(--nyte-radius-16)",
  "--nyte-toast-close-gutter": "var(--nyte-spacing-44)",
  "--nyte-clipboard-preview-max-width": "var(--nyte-sizing-360)",
  "--nyte-clipboard-preview-max-height": "var(--nyte-sizing-240)",
});
