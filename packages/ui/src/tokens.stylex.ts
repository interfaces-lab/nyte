/**
 * Tokens that never change inside a scope: the appearance inputs the desktop
 * sets on <html>, shadows, type, motion, and component measurements. Colour
 * lives in `theme.stylex.ts` and `roles.stylex.ts`; importing this file ships
 * all of them.
 *
 * Component measurements are named decisions on the 2px grid. A coarse
 * pointer gets the larger box Notion Calendar gives touch.
 */
import { defineVars } from "@stylexjs/stylex";
import "./theme.stylex.ts";
import "./roles.stylex.ts";

/** Each group is one concern, so the desktop's theme classes never collide. */
export const displayMode = defineVars({
  "--nyte-popup-material-filter": "blur(12px)",
});

export const pointerCursor = defineVars({
  "--nyte-cursor-interactive": "pointer",
});

/** 1 makes the materials opaque. */
export const transparency = defineVars({
  "--nyte-reduce-transparency": "0",
});

/**
 * Notion's fixed blue-80 marks focus. A field shows it whenever it holds the
 * caret; the ring around other controls clears while focus arrives by pointer.
 */
export const focusModality = defineVars({
  "--nyte-focus-color": "lab(53.1052% -1.53607 -54.9391)",
  "--nyte-focus-ring": "var(--nyte-focus-color)",
});

export const elevation = defineVars({
  "--nyte-shadow-sm": "0 4px 12px #42230308, 0 1px 2px #42230308",
  "--nyte-shadow-md": "0 8px 12px #42230308, 0 2px 6px #42230308",
  "--nyte-shadow-lg": "0 20px 24px #2a1c0012, 0 5px 8px #42230308",
  "--nyte-shadow-xl": "0 24px 72px -24px #1b150030, 0 8px 32px #2a1c0012",
  "--nyte-shadow-workbench": "0 0 8px 2px #00000014",
});

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

export const components = defineVars({
  "--nyte-btn-height-2xs": {
    default: "16px",
    "@media (pointer: coarse)": "28px",
  },
  "--nyte-btn-padding-inline-2xs": {
    default: "4px",
    "@media (pointer: coarse)": "8px",
  },
  "--nyte-btn-pill-padding-inline-2xs": {
    default: "6px",
    "@media (pointer: coarse)": "10px",
  },
  "--nyte-btn-radius-2xs": {
    default: "4px",
    "@media (pointer: coarse)": "8px",
  },
  "--nyte-btn-gap-2xs": {
    default: "4px",
    "@media (pointer: coarse)": "6px",
  },
  "--nyte-btn-height-xs": {
    default: "20px",
    "@media (pointer: coarse)": "32px",
  },
  "--nyte-btn-padding-inline-xs": {
    default: "6px",
    "@media (pointer: coarse)": "10px",
  },
  "--nyte-btn-pill-padding-inline-xs": {
    default: "6px",
    "@media (pointer: coarse)": "12px",
  },
  "--nyte-btn-radius-xs": {
    default: "4px",
    "@media (pointer: coarse)": "10px",
  },
  "--nyte-btn-gap-xs": {
    default: "4px",
    "@media (pointer: coarse)": "8px",
  },
  "--nyte-btn-height-sm": {
    default: "24px",
    "@media (pointer: coarse)": "36px",
  },
  "--nyte-btn-padding-inline-sm": {
    default: "8px",
    "@media (pointer: coarse)": "10px",
  },
  "--nyte-btn-pill-padding-inline-sm": {
    default: "10px",
    "@media (pointer: coarse)": "16px",
  },
  "--nyte-btn-radius-sm": {
    default: "6px",
    "@media (pointer: coarse)": "12px",
  },
  "--nyte-btn-gap-sm": {
    default: "6px",
    "@media (pointer: coarse)": "8px",
  },
  "--nyte-btn-height-md": {
    default: "28px",
    "@media (pointer: coarse)": "40px",
  },
  "--nyte-btn-padding-inline-md": {
    default: "8px",
    "@media (pointer: coarse)": "12px",
  },
  "--nyte-btn-pill-padding-inline-md": {
    default: "10px",
    "@media (pointer: coarse)": "16px",
  },
  "--nyte-btn-radius-md": {
    default: "8px",
    "@media (pointer: coarse)": "12px",
  },
  "--nyte-btn-gap-md": {
    default: "6px",
    "@media (pointer: coarse)": "10px",
  },
  "--nyte-btn-height-lg": {
    default: "32px",
    "@media (pointer: coarse)": "44px",
  },
  "--nyte-btn-padding-inline-lg": {
    default: "10px",
    "@media (pointer: coarse)": "14px",
  },
  "--nyte-btn-pill-padding-inline-lg": {
    default: "12px",
    "@media (pointer: coarse)": "16px",
  },
  "--nyte-btn-radius-lg": {
    default: "8px",
    "@media (pointer: coarse)": "14px",
  },
  "--nyte-btn-gap-lg": {
    default: "8px",
    "@media (pointer: coarse)": "10px",
  },
  "--nyte-btn-height-xl": {
    default: "36px",
    "@media (pointer: coarse)": "48px",
  },
  "--nyte-btn-padding-inline-xl": {
    default: "12px",
    "@media (pointer: coarse)": "16px",
  },
  "--nyte-btn-pill-padding-inline-xl": {
    default: "12px",
    "@media (pointer: coarse)": "20px",
  },
  "--nyte-btn-radius-xl": {
    default: "10px",
    "@media (pointer: coarse)": "16px",
  },
  "--nyte-btn-gap-xl": {
    default: "8px",
    "@media (pointer: coarse)": "12px",
  },
  "--nyte-icon-btn-padding-inline": "4px",
  "--nyte-input-height-md": {
    default: "28px",
    "@media (pointer: coarse)": "40px",
  },
  "--nyte-input-inset-md": "4px",
  "--nyte-input-padding-end-md": "calc(4px + 2px)",
  "--nyte-input-textarea-min-height-md": {
    default: "48px",
    "@media (pointer: coarse)": "calc(72px - 2px)",
  },
  "--nyte-input-textarea-padding-block-md": {
    default: "4px",
    "@media (pointer: coarse)": "9px",
  },
  "--nyte-input-radius-md": {
    default: "8px",
    "@media (pointer: coarse)": "12px",
  },
  "--nyte-input-height-lg": {
    default: "32px",
    "@media (pointer: coarse)": "44px",
  },
  "--nyte-input-inset-lg": "6px",
  "--nyte-input-padding-end-lg": "calc(6px + 2px)",
  "--nyte-input-textarea-min-height-lg": {
    default: "52px",
    "@media (pointer: coarse)": "72px",
  },
  "--nyte-input-textarea-padding-block-lg": {
    default: "6px",
    "@media (pointer: coarse)": "10px",
  },
  "--nyte-input-radius-lg": {
    default: "8px",
    "@media (pointer: coarse)": "14px",
  },
  "--nyte-input-height-xl": {
    default: "36px",
    "@media (pointer: coarse)": "48px",
  },
  "--nyte-input-inset-xl": "8px",
  "--nyte-input-padding-end-xl": "calc(8px + 2px)",
  "--nyte-input-textarea-min-height-xl": {
    default: "56px",
    "@media (pointer: coarse)": "calc(72px + 4px)",
  },
  "--nyte-input-textarea-padding-block-xl": {
    default: "8px",
    "@media (pointer: coarse)": "12px",
  },
  "--nyte-input-radius-xl": {
    default: "10px",
    "@media (pointer: coarse)": "16px",
  },
  "--nyte-switch-width-md": {
    default: "28px",
    "@media (pointer: coarse)": "48px",
  },
  "--nyte-switch-height-md": {
    default: "16px",
    "@media (pointer: coarse)": "28px",
  },
  "--nyte-switch-padding-md": {
    default: "2px",
    "@media (pointer: coarse)": "3px",
  },
  "--nyte-switch-knob-md": {
    default: "12px",
    "@media (pointer: coarse)": "22px",
  },
  "--nyte-switch-width-sm": {
    default: "20px",
    "@media (pointer: coarse)": "48px",
  },
  "--nyte-switch-height-sm": {
    default: "12px",
    "@media (pointer: coarse)": "28px",
  },
  "--nyte-switch-padding-sm": {
    default: "2px",
    "@media (pointer: coarse)": "3px",
  },
  "--nyte-switch-knob-sm": {
    default: "8px",
    "@media (pointer: coarse)": "22px",
  },
  "--nyte-checkbox-size-md": {
    default: "16px",
    "@media (pointer: coarse)": "20px",
  },
  "--nyte-checkbox-size-lg": "20px",
  "--nyte-checkbox-radius": "4px",
  "--nyte-row-height-md": {
    default: "28px",
    "@media (pointer: coarse)": "44px",
  },
  "--nyte-row-height-lg": {
    default: "32px",
    "@media (pointer: coarse)": "44px",
  },
  "--nyte-row-padding-inline-md": "4px",
  "--nyte-row-padding-inline-lg": "6px",
  "--nyte-row-gap": "6px",
  "--nyte-row-radius": "8px",
  "--nyte-glyph-box": "15px",
  "--nyte-menu-item-height": {
    default: "28px",
    "@media (pointer: coarse)": "44px",
  },
  "--nyte-menu-padding": "6px",
  "--nyte-menu-radius": "14px",
  "--nyte-menu-item-radius": "8px",
  "--nyte-menu-item-gap": "6px",
  "--nyte-menu-item-padding-inline": "4px",
  "--nyte-menu-item-padding-block": {
    default: "calc((28px - var(--nyte-line-height-base)) / 2)",
    "@media (pointer: coarse)": "calc((44px - var(--nyte-line-height-base)) / 2)",
  },
  "--nyte-menu-width": "200px",
  "--nyte-model-menu-width": "230px",
  "--nyte-parameter-menu-width": "220px",
  "--nyte-menu-max-height": "min(320px, calc(100vh - 32px))",
  "--nyte-dialog-width": "400px",
  "--nyte-dialog-padding": "24px",
  "--nyte-dialog-gap": "16px",
  "--nyte-dialog-radius": "16px",
  "--nyte-toast-close-gutter": "44px",
  "--nyte-clipboard-preview-max-width": "360px",
  "--nyte-clipboard-preview-max-height": "240px",
  "--nyte-shape-square": "0px",
  "--nyte-shape-indicator": "4px",
  "--nyte-shape-control": "8px",
  "--nyte-shape-card": "12px",
  "--nyte-shape-surface": "16px",
  "--nyte-shape-pill": "9999px",
});
