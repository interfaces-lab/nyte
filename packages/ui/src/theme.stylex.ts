/**
 * The theme layer: one ramp the roles read, gray unless a scope in
 * `surface-theme.ts` swaps in a hue. Nothing paints with these directly.
 */
import { defineVars } from "@stylexjs/stylex";

import "./ramps.stylex.ts";

export const theme = defineVars({
  "--nyte-theme-0": "var(--nyte-gray-0)",
  "--nyte-theme-5": "var(--nyte-gray-5)",
  "--nyte-theme-10": "var(--nyte-gray-10)",
  "--nyte-theme-15": "var(--nyte-gray-15)",
  "--nyte-theme-20": "var(--nyte-gray-20)",
  "--nyte-theme-30": "var(--nyte-gray-30)",
  "--nyte-theme-40": "var(--nyte-gray-40)",
  "--nyte-theme-50": "var(--nyte-gray-50)",
  "--nyte-theme-60": "var(--nyte-gray-60)",
  "--nyte-theme-70": "var(--nyte-gray-70)",
  "--nyte-theme-80": "var(--nyte-gray-80)",
  "--nyte-theme-90": "var(--nyte-gray-90)",
  "--nyte-theme-100": "var(--nyte-gray-100)",
  "--nyte-theme-110": "var(--nyte-gray-110)",
  "--nyte-theme-120": "var(--nyte-gray-120)",
  "--nyte-theme-130": "var(--nyte-gray-130)",
  "--nyte-theme-135": "var(--nyte-gray-135)",
  "--nyte-theme-140": "var(--nyte-gray-140)",
  "--nyte-theme-145": "var(--nyte-gray-145)",
  "--nyte-theme-150": "var(--nyte-gray-150)",
  "--nyte-theme-translucent-0": "var(--nyte-translucent-gray-0)",
  "--nyte-theme-translucent-5": "var(--nyte-translucent-gray-5)",
  "--nyte-theme-translucent-10": "var(--nyte-translucent-gray-10)",
  "--nyte-theme-translucent-15": "var(--nyte-translucent-gray-15)",
  "--nyte-theme-translucent-20": "var(--nyte-translucent-gray-20)",
  "--nyte-theme-translucent-30": "var(--nyte-translucent-gray-30)",
  "--nyte-theme-translucent-40": "var(--nyte-translucent-gray-40)",
  "--nyte-theme-translucent-50": "var(--nyte-translucent-gray-50)",
  "--nyte-theme-translucent-60": "var(--nyte-translucent-gray-60)",
  "--nyte-theme-translucent-70": "var(--nyte-translucent-gray-70)",
  "--nyte-theme-translucent-80": "var(--nyte-translucent-gray-80)",
  "--nyte-theme-translucent-90": "var(--nyte-translucent-gray-90)",
  "--nyte-theme-translucent-100": "var(--nyte-translucent-gray-100)",
  "--nyte-theme-translucent-110": "var(--nyte-translucent-gray-110)",
  "--nyte-theme-translucent-120": "var(--nyte-translucent-gray-120)",
  "--nyte-theme-translucent-130": "var(--nyte-translucent-gray-130)",
  "--nyte-theme-translucent-135": "var(--nyte-translucent-gray-135)",
  "--nyte-theme-translucent-140": "var(--nyte-translucent-gray-140)",
  "--nyte-theme-translucent-145": "var(--nyte-translucent-gray-145)",
  "--nyte-theme-translucent-150": "var(--nyte-translucent-gray-150)",
});
