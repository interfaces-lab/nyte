/**
 * Typed handles on `palette.css`. Shared, and nobody edits it.
 *
 * Constants rather than `defineVars`: the reference never changes, only the
 * custom property behind it does, and both appearances declare the same names.
 *
 * Read a step by the role you want, not by how it happens to composite. Light
 * and dark disagree about which steps are alpha, so `green-30` is "the added
 * wash" in both and a translucent value in only one.
 */
import * as stylex from "@stylexjs/stylex";

export const color = stylex.defineConsts({
  surfacePage: "var(--surface-page)",
  surfaceWash: "var(--surface-wash)",
  surfaceElevated: "var(--surface-elevated)",
  surfaceContrast: "var(--surface-contrast)",

  materialFill: "var(--material-fill)",
  materialEffect: "var(--material-effect)",
  materialClip: "var(--material-clip)",
  scrim: "var(--scrim)",

  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textTertiary: "var(--text-tertiary)",
  textQuaternary: "var(--text-quaternary)",
  textOnContrast: "var(--text-on-contrast)",

  iconPrimary: "var(--icon-primary)",
  iconSecondary: "var(--icon-secondary)",
  iconTertiary: "var(--icon-tertiary)",
  iconQuaternary: "var(--icon-quaternary)",

  strokePrimary: "var(--stroke-primary)",
  strokeSecondary: "var(--stroke-secondary)",
  strokeInput: "var(--stroke-input)",

  stateHover: "var(--state-hover)",
  stateSelected: "var(--state-selected)",
  statePressed: "var(--state-pressed)",

  shadow2xs: "var(--shadow-2xs)",
  shadowXs: "var(--shadow-xs)",
  shadowSm: "var(--shadow-sm)",
  shadowMd: "var(--shadow-md)",
  shadowLg: "var(--shadow-lg)",

  easeDefault: "var(--ease-default)",
  easeEnter: "var(--ease-enter)",
  easeExit: "var(--ease-exit)",

  weightRegular: "var(--weight-regular)",
  weightMedium: "var(--weight-medium)",
  weightSemibold: "var(--weight-semibold)",
  weightBold: "var(--weight-bold)",

  gray30: "var(--gray-30)",
  gray100: "var(--gray-100)",
  gray500: "var(--gray-500)",
  gray800: "var(--gray-800)",
  blue30: "var(--blue-30)",
  blue500: "var(--blue-500)",
  blue600: "var(--blue-600)",
  green30: "var(--green-30)",
  green500: "var(--green-500)",
  green600: "var(--green-600)",
  red30: "var(--red-30)",
  red500: "var(--red-500)",
  red600: "var(--red-600)",
  yellow30: "var(--yellow-30)",
  yellow500: "var(--yellow-500)",
});
