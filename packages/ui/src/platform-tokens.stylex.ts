import * as stylex from "@stylexjs/stylex";

// Raw appearance pairs. `defineConsts` inlines these at compile time, so a
// StyleX build reads them as literals and a React Strict DOM build gets the same
// literals for React Native props that cannot take a CSS variable.
export const lightPalette = stylex.defineConsts({
  background: "#fcfcfc",
  foreground: "#141414",
  popover: "#fcfcfc",
  popoverForeground: "#141414",
  primary: "#070707",
  primaryHover: "#2f2f2f",
  primaryForeground: "#fcfcfc",
  muted: "#77777717",
  mutedHover: "#7777772b",
  mutedForeground: "#14141499",
  tertiaryForeground: "#14141466",
  accent: "#0c64c1",
  success: "#009957",
  destructive: "#c21d2e",
  destructiveMuted: "#ff263c17",
  destructiveHover: "#ff263c2b",
  warning: "#c27400",
  borderSubtle: "#1414140d",
  borderWeak: "#1414141a",
  border: "#14141426",
  borderStrong: "#1414144d",
  fieldBackground: "#fcfcfc",
  ring: "#14141466",
  scrim: "#14141480",
  sidebar: "#f7f7f7",
  bubbleAgent: "#eeeeee",
  bubbleUser: "#070707",
  bubbleUserForeground: "#fcfcfc",
  avatarBackground: "#77777717",
  avatarForeground: "#3d3d3d",
  avatarNeutralSolid: "#777777",
  avatarOrangeBackground: "#ff670017",
  avatarOrangeForeground: "#c24e00",
  avatarOrangeSolid: "#ff6700",
  avatarBlueBackground: "#1084fe17",
  avatarBlueForeground: "#0c64c1",
  avatarBlueSolid: "#1084fe",
  avatarVioletBackground: "#9159fe17",
  avatarVioletForeground: "#6e44c1",
  avatarVioletSolid: "#9159fe",
  avatarGreenBackground: "#00c97217",
  avatarGreenForeground: "#009957",
  avatarGreenSolid: "#00c972",
});

export const darkPalette = stylex.defineConsts({
  background: "#181818",
  foreground: "#fcfcfc",
  popover: "#181818",
  popoverForeground: "#fcfcfc",
  primary: "#fafafa",
  primaryHover: "#d5d5d5",
  primaryForeground: "#141414",
  muted: "#7777772c",
  mutedHover: "#77777752",
  mutedForeground: "#fcfcfc99",
  tertiaryForeground: "#fcfcfc66",
  accent: "#459ffe",
  success: "#38d591",
  destructive: "#ff5667",
  destructiveMuted: "#ff263c2c",
  destructiveHover: "#ff263c52",
  warning: "#ffaf38",
  borderSubtle: "#fcfcfc0d",
  borderWeak: "#fcfcfc1a",
  border: "#fcfcfc26",
  borderStrong: "#fcfcfc4d",
  fieldBackground: "#2f2f2f",
  ring: "#fcfcfc66",
  scrim: "#141414b2",
  sidebar: "#141414",
  bubbleAgent: "#262626",
  bubbleUser: "#5a5a5a",
  bubbleUserForeground: "#fcfcfc",
  avatarBackground: "#7777772c",
  avatarForeground: "#b7b7b7",
  avatarNeutralSolid: "#777777",
  avatarOrangeBackground: "#ff67002c",
  avatarOrangeForeground: "#ff8838",
  avatarOrangeSolid: "#ff6700",
  avatarBlueBackground: "#1084fe2c",
  avatarBlueForeground: "#459ffe",
  avatarBlueSolid: "#1084fe",
  avatarVioletBackground: "#9159fe2c",
  avatarVioletForeground: "#a97efe",
  avatarVioletSolid: "#9159fe",
  avatarGreenBackground: "#00c9722c",
  avatarGreenForeground: "#38d591",
  avatarGreenSolid: "#00c972",
});

const colorDefaults = {
  "--nyte-color-background": `light-dark(${lightPalette.background}, ${darkPalette.background})`,
  "--nyte-color-foreground": `light-dark(${lightPalette.foreground}, ${darkPalette.foreground})`,
  "--nyte-color-popover": `light-dark(${lightPalette.popover}, ${darkPalette.popover})`,
  "--nyte-color-popover-foreground": `light-dark(${lightPalette.popoverForeground}, ${darkPalette.popoverForeground})`,
  "--nyte-color-primary": `light-dark(${lightPalette.primary}, ${darkPalette.primary})`,
  "--nyte-color-primary-hover": `light-dark(${lightPalette.primaryHover}, ${darkPalette.primaryHover})`,
  "--nyte-color-primary-foreground": `light-dark(${lightPalette.primaryForeground}, ${darkPalette.primaryForeground})`,
  "--nyte-color-muted": `light-dark(${lightPalette.muted}, ${darkPalette.muted})`,
  "--nyte-color-muted-hover": `light-dark(${lightPalette.mutedHover}, ${darkPalette.mutedHover})`,
  "--nyte-color-muted-foreground": `light-dark(${lightPalette.mutedForeground}, ${darkPalette.mutedForeground})`,
  "--nyte-color-tertiary-foreground": `light-dark(${lightPalette.tertiaryForeground}, ${darkPalette.tertiaryForeground})`,
  "--nyte-color-accent": `light-dark(${lightPalette.accent}, ${darkPalette.accent})`,
  "--nyte-color-success": `light-dark(${lightPalette.success}, ${darkPalette.success})`,
  "--nyte-color-destructive": `light-dark(${lightPalette.destructive}, ${darkPalette.destructive})`,
  "--nyte-color-destructive-muted": `light-dark(${lightPalette.destructiveMuted}, ${darkPalette.destructiveMuted})`,
  "--nyte-color-destructive-hover": `light-dark(${lightPalette.destructiveHover}, ${darkPalette.destructiveHover})`,
  "--nyte-color-warning": `light-dark(${lightPalette.warning}, ${darkPalette.warning})`,
  "--nyte-color-border-subtle": `light-dark(${lightPalette.borderSubtle}, ${darkPalette.borderSubtle})`,
  "--nyte-color-border-weak": `light-dark(${lightPalette.borderWeak}, ${darkPalette.borderWeak})`,
  "--nyte-color-border": `light-dark(${lightPalette.border}, ${darkPalette.border})`,
  "--nyte-color-border-strong": `light-dark(${lightPalette.borderStrong}, ${darkPalette.borderStrong})`,
  "--nyte-color-field-background": `light-dark(${lightPalette.fieldBackground}, ${darkPalette.fieldBackground})`,
  "--nyte-color-ring": `light-dark(${lightPalette.ring}, ${darkPalette.ring})`,
  // Chromium matches `:focus-visible` on every text field focus, pointer included,
  // so the color gates the ring where the selector cannot. index.css drops this to
  // transparent while the host marks the document `data-nyte-focus-modality="pointer"`.
  "--nyte-color-focus-ring": "var(--nyte-color-ring)",
  "--nyte-color-scrim": `light-dark(${lightPalette.scrim}, ${darkPalette.scrim})`,
  "--nyte-color-sidebar": `light-dark(${lightPalette.sidebar}, ${darkPalette.sidebar})`,
  "--nyte-color-bubble-agent": `light-dark(${lightPalette.bubbleAgent}, ${darkPalette.bubbleAgent})`,
  "--nyte-color-bubble-user": `light-dark(${lightPalette.bubbleUser}, ${darkPalette.bubbleUser})`,
  "--nyte-color-bubble-user-foreground": `light-dark(${lightPalette.bubbleUserForeground}, ${darkPalette.bubbleUserForeground})`,
  "--nyte-color-avatar-background": `light-dark(${lightPalette.avatarBackground}, ${darkPalette.avatarBackground})`,
  "--nyte-color-avatar-foreground": `light-dark(${lightPalette.avatarForeground}, ${darkPalette.avatarForeground})`,
  "--nyte-color-avatar-neutral-solid": `light-dark(${lightPalette.avatarNeutralSolid}, ${darkPalette.avatarNeutralSolid})`,
  "--nyte-color-avatar-orange-background": `light-dark(${lightPalette.avatarOrangeBackground}, ${darkPalette.avatarOrangeBackground})`,
  "--nyte-color-avatar-orange-foreground": `light-dark(${lightPalette.avatarOrangeForeground}, ${darkPalette.avatarOrangeForeground})`,
  "--nyte-color-avatar-orange-solid": `light-dark(${lightPalette.avatarOrangeSolid}, ${darkPalette.avatarOrangeSolid})`,
  "--nyte-color-avatar-blue-background": `light-dark(${lightPalette.avatarBlueBackground}, ${darkPalette.avatarBlueBackground})`,
  "--nyte-color-avatar-blue-foreground": `light-dark(${lightPalette.avatarBlueForeground}, ${darkPalette.avatarBlueForeground})`,
  "--nyte-color-avatar-blue-solid": `light-dark(${lightPalette.avatarBlueSolid}, ${darkPalette.avatarBlueSolid})`,
  "--nyte-color-avatar-violet-background": `light-dark(${lightPalette.avatarVioletBackground}, ${darkPalette.avatarVioletBackground})`,
  "--nyte-color-avatar-violet-foreground": `light-dark(${lightPalette.avatarVioletForeground}, ${darkPalette.avatarVioletForeground})`,
  "--nyte-color-avatar-violet-solid": `light-dark(${lightPalette.avatarVioletSolid}, ${darkPalette.avatarVioletSolid})`,
  "--nyte-color-avatar-green-background": `light-dark(${lightPalette.avatarGreenBackground}, ${darkPalette.avatarGreenBackground})`,
  "--nyte-color-avatar-green-foreground": `light-dark(${lightPalette.avatarGreenForeground}, ${darkPalette.avatarGreenForeground})`,
  "--nyte-color-avatar-green-solid": `light-dark(${lightPalette.avatarGreenSolid}, ${darkPalette.avatarGreenSolid})`,
} as const;

const fontDefaults = {
  "--nyte-font-family-ui": '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--nyte-font-size-caption": "11px",
  "--nyte-font-size-detail": "12px",
  "--nyte-font-size-label": "13px",
  "--nyte-font-size-body": "13px",
  "--nyte-font-size-title": "14px",
  "--nyte-font-weight-regular": 400,
  "--nyte-font-weight-medium": 500,
  "--nyte-font-weight-semibold": 600,
  "--nyte-leading-caption": "14px",
  "--nyte-leading-detail": "16px",
  "--nyte-leading-label": "18px",
  "--nyte-leading-body": "18px",
  "--nyte-leading-title": "22px",
} as const;

const radiusDefaults = {
  "--nyte-radius-control": "8px",
  "--nyte-radius-field": "8px",
  "--nyte-radius-menu": "10px",
  "--nyte-radius-dialog": "14px",
  "--nyte-radius-avatar": "42%",
  "--nyte-radius-pill": "9999px",
} as const;

const controlDefaults = {
  "--nyte-control-height-sm": "24px",
  "--nyte-control-height-md": "28px",
  "--nyte-control-textarea-min-height": "64px",
  "--nyte-control-padding-xs": "6px",
  "--nyte-control-padding-sm": "8px",
  "--nyte-control-padding-lg": "12px",
  "--nyte-control-menu-inset": "28px",
  "--nyte-control-gap-sm": "4px",
  "--nyte-control-disabled-opacity": 0.56,
  "--nyte-control-focus-width": "1px",
  "--nyte-control-focus-offset": "1px",
} as const;

const borderDefaults = {
  "--nyte-border-control-width": "1px",
  "--nyte-border-hairline-width": ".5px",
} as const;

const avatarDefaults = {
  "--nyte-avatar-size-xs": "20px",
  "--nyte-avatar-size-sm": "24px",
  "--nyte-avatar-size-md": "28px",
  "--nyte-avatar-size-lg": "36px",
  "--nyte-avatar-font-xs": "9px",
  "--nyte-avatar-font-sm": "10px",
  "--nyte-avatar-font-md": "11px",
  "--nyte-avatar-font-lg": "14px",
  "--nyte-avatar-ring-width": ".5px",
} as const;

const spaceDefaults = {
  "--nyte-space-1": "4px",
  "--nyte-space-2": "8px",
  "--nyte-space-4": "16px",
} as const;

const motionDefaults = {
  "--nyte-motion-fast": "100ms",
  "--nyte-motion-normal": "160ms",
  "--nyte-motion-ease-out": "cubic-bezier(.2,.8,.2,1)",
} as const;

const elevationDefaults = {
  "--nyte-elevation-field": "0 1px 3px 0 light-dark(#0000001f, #00000000)",
  "--nyte-elevation-menu":
    "0 10px 20px -3px light-dark(#0000001a, #00000000), 0 4px 6px -4px light-dark(#0000001a, #00000000), 0 0 0 1px light-dark(#e4e4e40a, #e4e4e400)",
  "--nyte-elevation-dialog":
    "0 22px 70px 4px light-dark(#0000008f, #00000000), 0 0 0 .5px light-dark(#0000001a, #00000000)",
} as const;

const overlayDefaults = {
  "--nyte-dialog-width": "calc(100% - 32px)",
  "--nyte-dialog-max-width": "384px",
  "--nyte-dialog-max-height": "calc(100dvh - 32px)",
  "--nyte-menu-min-width": "160px",
  "--nyte-menu-max-width": "var(--available-width)",
  "--nyte-menu-max-height": "var(--available-height)",
  "--nyte-layer-dialog": 50,
  "--nyte-layer-menu": 60,
} as const;

export const colorVars = stylex.defineVars(colorDefaults);
export const fontVars = stylex.defineVars(fontDefaults);
export const radiusVars = stylex.defineVars(radiusDefaults);
export const controlVars = stylex.defineVars(controlDefaults);
export const borderVars = stylex.defineVars(borderDefaults);
export const avatarVars = stylex.defineVars(avatarDefaults);
export const spaceVars = stylex.defineVars(spaceDefaults);
export const motionVars = stylex.defineVars(motionDefaults);
export const elevationVars = stylex.defineVars(elevationDefaults);
export const overlayVars = stylex.defineVars(overlayDefaults);

// Components read the group exports above, not this object. StyleX resolves
// `--nyte-*` keys to literal names only through a direct `defineVars` import;
// reading through a plain object hashes them into names nothing defines. The
// object remains for consumers that want one typed handle.
export const tokens = {
  color: colorVars,
  font: fontVars,
  radius: radiusVars,
  control: controlVars,
  border: borderVars,
  avatar: avatarVars,
  space: spaceVars,
  motion: motionVars,
  elevation: elevationVars,
  overlay: overlayVars,
} as const;
