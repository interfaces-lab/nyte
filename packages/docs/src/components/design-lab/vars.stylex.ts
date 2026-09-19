/**
 * Typed handles on the NDS palette, shaped like `theme/vars.stylex.ts`.
 *
 * States are named for what they are and ordered by value, so a call site
 * cannot reach for the wrong one and land hover above selected.
 */
import * as stylex from "@stylexjs/stylex";

export const t = stylex.defineConsts({
  surfacePage: "var(--nds-surface-page)",
  surfaceWash: "var(--nds-surface-wash)",
  surfaceSunken: "var(--nds-surface-sunken)",
  surfaceElevated: "var(--nds-surface-elevated)",
  surfaceContrast: "var(--nds-surface-contrast)",
  surfaceWax: "var(--nds-surface-elevated-wax)",
  waxEffect: "var(--nds-wax-effect)",
  scrim: "var(--nds-scrim)",

  textPrimary: "var(--nds-text-primary)",
  textSecondary: "var(--nds-text-secondary)",
  textTertiary: "var(--nds-text-tertiary)",
  textQuaternary: "var(--nds-text-quaternary)",
  textContrast: "var(--nds-text-contrast)",

  iconSecondary: "var(--nds-icon-secondary)",
  iconTertiary: "var(--nds-icon-tertiary)",
  iconQuaternary: "var(--nds-icon-quaternary)",

  strokePrimary: "var(--nds-stroke-primary)",
  strokeSecondary: "var(--nds-stroke-secondary)",

  stateHover: "var(--nds-state-hover)",
  stateSelected: "var(--nds-state-selected)",
  statePressed: "var(--nds-state-pressed)",
  stateSelectedHover: "var(--nds-state-selected-hover)",

  shadowXs: "var(--nds-shadow-xs)",
  shadowSm: "var(--nds-shadow-sm)",
  shadowLg: "var(--nds-shadow-lg)",
  shadowWax: "var(--nds-wax-shadow)",

  success: "var(--nds-success)",
  successWash: "var(--nds-success-wash)",
  danger: "var(--nds-danger)",
  dangerWash: "var(--nds-danger-wash)",
  warning: "var(--nds-warning)",
  info: "var(--nds-info)",
  infoWash: "var(--nds-info-wash)",
  accent: "var(--nyte-accent)",

  /* A few ramp steps read directly, where a role name would be invented. */
  gray100: "var(--nds-gray-100)",
  blue600: "var(--nds-blue-600)",
  green600: "var(--nds-green-600)",
  red600: "var(--nds-red-600)",

  easeDefault: "var(--nds-ease-default)",
  easeEnter: "var(--nds-ease-enter)",

  weightRegular: "var(--nds-weight-regular)",
  weightMedium: "var(--nds-weight-medium)",
  weightSemibold: "var(--nds-weight-semibold)",
});

/** Geometry stays Nyte's, from `theme/schema.stylex.ts` and `theme/tokens.css`. */
export const g = stylex.defineConsts({
  titlebarHeight: "35px",
  trafficLightInset: "72px",
  headerHeight: "35px",
  sidebarWidth: "220px",
  sidebarRowHeight: "28px",
  sidebarGutter: "8px",
  sidebarRowPaddingInline: "4px",
  sidebarRowGap: "6px",
  sidebarIconSlot: "20px",
  sidebarTrailingWidth: "44px",
  sidebarActionSize: "24px",
  menuItemHeight: "26px",
  conversationMeasure: "840px",
  conversationGutter: "16px",
  turnGap: "14px",
  rowGap: "8px",
  composerInset: "14px",
  composerExpandedRadius: "18px",

  radius4: "4px",
  radius6: "6px",
  radius8: "8px",
  radius12: "12px",
  radius14: "14px",
  radiusFull: "9999px",

  bodyXs: "11px",
  bodyXsLeading: "14px",
  bodySm: "12px",
  bodySmLeading: "16px",
  body: "13px",
  bodyLeading: "20px",
  bodyLg: "15px",
  bodyLgLeading: "24px",
  title: "16px",
  titleLeading: "22px",

  durationFast: "100ms",
  durationNormal: "160ms",
});
