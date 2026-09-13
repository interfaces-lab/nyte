import * as stylex from "@stylexjs/stylex";

const colorDefaults = {
  "--nyte-color-background": "light-dark(#fcfcfc, #181818)",
  "--nyte-color-foreground": "light-dark(#141414, #fcfcfc)",
  "--nyte-color-popover": "light-dark(#fcfcfc, #181818)",
  "--nyte-color-popover-foreground": "light-dark(#141414, #fcfcfc)",
  "--nyte-color-primary": "light-dark(#070707, #fafafa)",
  "--nyte-color-primary-hover": "light-dark(#2f2f2f, #d5d5d5)",
  "--nyte-color-primary-foreground": "light-dark(#fcfcfc, #141414)",
  "--nyte-color-muted": "light-dark(#77777717, #7777772c)",
  "--nyte-color-muted-hover": "light-dark(#7777772b, #77777752)",
  "--nyte-color-muted-foreground": "light-dark(#14141499, #fcfcfc99)",
  "--nyte-color-tertiary-foreground": "light-dark(#14141466, #fcfcfc66)",
  "--nyte-color-accent": "light-dark(#0c64c1, #459ffe)",
  "--nyte-color-success": "light-dark(#009957, #38d591)",
  "--nyte-color-destructive": "light-dark(#c21d2e, #ff5667)",
  "--nyte-color-destructive-muted": "light-dark(#ff263c17, #ff263c2c)",
  "--nyte-color-destructive-hover": "light-dark(#ff263c2b, #ff263c52)",
  "--nyte-color-warning": "light-dark(#c27400, #ffaf38)",
  "--nyte-color-border-subtle": "light-dark(#1414140d, #fcfcfc0d)",
  "--nyte-color-border-weak": "light-dark(#1414141a, #fcfcfc1a)",
  "--nyte-color-border": "light-dark(#14141426, #fcfcfc26)",
  "--nyte-color-border-strong": "light-dark(#1414144d, #fcfcfc4d)",
  "--nyte-color-field-background": "light-dark(#fcfcfc, #2f2f2f)",
  "--nyte-color-ring": "light-dark(#14141466, #fcfcfc66)",
  // Chromium matches `:focus-visible` on every text field focus, pointer included,
  // so the color gates the ring where the selector cannot. index.css drops this to
  // transparent while the host marks the document `data-nyte-focus-modality="pointer"`.
  "--nyte-color-focus-ring": "var(--nyte-color-ring)",
  "--nyte-color-scrim": "light-dark(#14141480, #141414b2)",
  "--nyte-color-sidebar": "light-dark(#f7f7f7, #141414)",
  "--nyte-color-bubble-agent": "light-dark(#eeeeee, #262626)",
  "--nyte-color-bubble-user": "light-dark(#070707, #5a5a5a)",
  "--nyte-color-bubble-user-foreground": "light-dark(#fcfcfc, #fcfcfc)",
  "--nyte-color-avatar-background": "light-dark(#77777717, #7777772c)",
  "--nyte-color-avatar-foreground": "light-dark(#3d3d3d, #b7b7b7)",
  "--nyte-color-avatar-neutral-solid": "light-dark(#777777, #777777)",
  "--nyte-color-avatar-orange-background": "light-dark(#ff670017, #ff67002c)",
  "--nyte-color-avatar-orange-foreground": "light-dark(#c24e00, #ff8838)",
  "--nyte-color-avatar-orange-solid": "light-dark(#ff6700, #ff6700)",
  "--nyte-color-avatar-blue-background": "light-dark(#1084fe17, #1084fe2c)",
  "--nyte-color-avatar-blue-foreground": "light-dark(#0c64c1, #459ffe)",
  "--nyte-color-avatar-blue-solid": "light-dark(#1084fe, #1084fe)",
  "--nyte-color-avatar-violet-background": "light-dark(#9159fe17, #9159fe2c)",
  "--nyte-color-avatar-violet-foreground": "light-dark(#6e44c1, #a97efe)",
  "--nyte-color-avatar-violet-solid": "light-dark(#9159fe, #9159fe)",
  "--nyte-color-avatar-green-background": "light-dark(#00c97217, #00c9722c)",
  "--nyte-color-avatar-green-foreground": "light-dark(#009957, #38d591)",
  "--nyte-color-avatar-green-solid": "light-dark(#00c972, #00c972)",
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
