import { defineConsts } from "@stylexjs/stylex";

/**
 * In the product this chrome lives in the page, where app tokens don't reach, so it is literal.
 * The canvas in `overlay.tsx` paints the same colour from `ACCENT_RGB`; change both together.
 */
export const design = defineConsts({
  accent: "#3884ff",
  glow: "rgb(56 132 255 / 0.15)",
  labelShadow: "drop-shadow(0 2px 12px rgb(0 0 0 / 0.1))",
});

/**
 * The label and comment field invert the app's theme, as react-grab's do: a dark surface in a
 * light app and a light one in a dark app, so they stand apart from whatever page is under them.
 * defineConsts takes literals only, so these name the `role.contentPrimary` and `role.bgBase`
 * variables directly.
 */
export const inverse = defineConsts({
  surface: "var(--nyte-content-primary)",
  text: "var(--nyte-bg-base)",
  muted: "color-mix(in srgb, var(--nyte-bg-base) 62%, var(--nyte-content-primary))",
  faint: "color-mix(in srgb, var(--nyte-bg-base) 45%, var(--nyte-content-primary))",
  hairline: "color-mix(in srgb, var(--nyte-bg-base) 16%, transparent)",
});
