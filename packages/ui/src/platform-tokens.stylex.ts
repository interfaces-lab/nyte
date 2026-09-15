import * as stylex from "@stylexjs/stylex";

/*
 * The kit palette, in two layers, matching the desktop renderer's model:
 *
 * - Anchors, declared per appearance with `light-dark()`: base, editor, chrome,
 *   sidebar, raised, the primary fill, and the named hues.
 * - Everything a component names, mixed from those anchors, so overriding one
 *   anchor moves every step that hangs off it instead of leaving the two
 *   appearances to drift apart.
 *
 * Steps carry the desktop ratios, so a step reads the same against every
 * surface: text 60/36 of the base, strokes 30/12/8/4, and a hue wash at 9% in
 * light and 17% in dark, 17/32 on hover. The kit names no icon or background
 * step; those tiers gain ratios here when a component needs one.
 *
 * The kit holds its own anchor values rather than importing the desktop ones:
 * the docs site and the demos load this file alone.
 *
 * A literal belongs in an anchor. Anything else derives, which is what keeps a
 * native build honest — the generator resolves these expressions to concrete
 * colors, because React Native cannot evaluate `color-mix`.
 */
const colorDefaults = {
  // ── anchors ──
  "--nyte-color-base": "light-dark(#141414, #fcfcfc)",
  "--nyte-color-editor": "light-dark(#fcfcfc, #181818)",
  "--nyte-color-chrome": "light-dark(#eeeeee, #262626)",
  "--nyte-color-sidebar": "light-dark(#f7f7f7, #141414)",
  // A field sits above the page rather than on it, so dark mode lifts it; the
  // ramp mixes one base against one page and cannot hold that on both sides.
  "--nyte-color-raised": "light-dark(#fcfcfc, #2f2f2f)",
  "--nyte-color-fill": "light-dark(#070707, #fafafa)",
  "--nyte-color-fill-label": "light-dark(#fcfcfc, #141414)",
  // A label over a saturated or always-dark fill, where the surface ramp does
  // not apply, so it does not follow the appearance.
  "--nyte-color-action-label": "#fcfcfc",
  // A scrim darkens whatever it covers in both appearances.
  "--nyte-color-scrim-base": "#141414",
  "--nyte-color-accent-base": "#1084fe",
  "--nyte-color-hue-neutral": "#777777",
  "--nyte-color-hue-red": "#ff263c",
  "--nyte-color-hue-orange": "#ff6700",
  "--nyte-color-hue-violet": "#9159fe",
  "--nyte-color-hue-green": "#00c972",
  // Colored text carries a per-appearance anchor: a raw hue that passes on a
  // dark page fails on a light one, so no single mix serves both.
  "--nyte-color-accent": "light-dark(#0c64c1, #459ffe)",
  "--nyte-color-success": "light-dark(#009957, #38d591)",
  "--nyte-color-warning": "light-dark(#c27400, #ffaf38)",
  "--nyte-color-destructive": "light-dark(#c21d2e, #ff5667)",
  "--nyte-color-avatar-foreground": "light-dark(#3d3d3d, #b7b7b7)",
  "--nyte-color-avatar-orange-foreground": "light-dark(#c24e00, #ff8838)",
  "--nyte-color-avatar-violet-foreground": "light-dark(#6e44c1, #a97efe)",
  "--nyte-color-bubble-user": "light-dark(#070707, #5a5a5a)",

  // ── derived: surfaces ──
  "--nyte-color-background": "var(--nyte-color-editor)",
  "--nyte-color-popover": "var(--nyte-color-editor)",
  "--nyte-color-field-background": "var(--nyte-color-raised)",
  "--nyte-color-bubble-agent": "var(--nyte-color-chrome)",

  // ── derived: text and icons ──
  "--nyte-color-foreground": "var(--nyte-color-base)",
  "--nyte-color-popover-foreground": "var(--nyte-color-base)",
  "--nyte-color-muted-foreground": "color-mix(in srgb, var(--nyte-color-base) 60%, transparent)",
  "--nyte-color-tertiary-foreground": "color-mix(in srgb, var(--nyte-color-base) 36%, transparent)",

  // ── derived: fills ──
  "--nyte-color-primary": "var(--nyte-color-fill)",
  // Hover lets the page through the fill rather than naming a second literal.
  "--nyte-color-primary-hover":
    "color-mix(in srgb, var(--nyte-color-editor) 16%, var(--nyte-color-fill))",
  "--nyte-color-primary-foreground": "var(--nyte-color-fill-label)",
  "--nyte-color-bubble-user-foreground": "var(--nyte-color-action-label)",
  "--nyte-color-muted":
    "light-dark(color-mix(in srgb, var(--nyte-color-hue-neutral) 9%, transparent), color-mix(in srgb, var(--nyte-color-hue-neutral) 17%, transparent))",
  "--nyte-color-muted-hover":
    "light-dark(color-mix(in srgb, var(--nyte-color-hue-neutral) 17%, transparent), color-mix(in srgb, var(--nyte-color-hue-neutral) 32%, transparent))",
  "--nyte-color-destructive-muted":
    "light-dark(color-mix(in srgb, var(--nyte-color-hue-red) 9%, transparent), color-mix(in srgb, var(--nyte-color-hue-red) 17%, transparent))",
  "--nyte-color-destructive-hover":
    "light-dark(color-mix(in srgb, var(--nyte-color-hue-red) 17%, transparent), color-mix(in srgb, var(--nyte-color-hue-red) 32%, transparent))",
  "--nyte-color-scrim":
    "light-dark(color-mix(in srgb, var(--nyte-color-scrim-base) 50%, transparent), color-mix(in srgb, var(--nyte-color-scrim-base) 70%, transparent))",

  // ── derived: strokes ──
  "--nyte-color-border-subtle": "color-mix(in srgb, var(--nyte-color-base) 4%, transparent)",
  "--nyte-color-border-weak": "color-mix(in srgb, var(--nyte-color-base) 8%, transparent)",
  "--nyte-color-border": "color-mix(in srgb, var(--nyte-color-base) 12%, transparent)",
  "--nyte-color-border-strong": "color-mix(in srgb, var(--nyte-color-base) 30%, transparent)",
  "--nyte-color-ring": "color-mix(in srgb, var(--nyte-color-base) 40%, transparent)",
  // Chromium matches `:focus-visible` on every text field focus, pointer included,
  // so the color gates the ring where the selector cannot. index.css drops this to
  // transparent while the host marks the document `data-nyte-focus-modality="pointer"`.
  "--nyte-color-focus-ring": "var(--nyte-color-ring)",

  // ── derived: avatars ──
  "--nyte-color-avatar-background": "var(--nyte-color-muted)",
  "--nyte-color-avatar-neutral-solid": "var(--nyte-color-hue-neutral)",
  "--nyte-color-avatar-orange-background":
    "light-dark(color-mix(in srgb, var(--nyte-color-hue-orange) 9%, transparent), color-mix(in srgb, var(--nyte-color-hue-orange) 17%, transparent))",
  "--nyte-color-avatar-orange-solid": "var(--nyte-color-hue-orange)",
  "--nyte-color-avatar-blue-background":
    "light-dark(color-mix(in srgb, var(--nyte-color-accent-base) 9%, transparent), color-mix(in srgb, var(--nyte-color-accent-base) 17%, transparent))",
  "--nyte-color-avatar-blue-foreground": "var(--nyte-color-accent)",
  "--nyte-color-avatar-blue-solid": "var(--nyte-color-accent-base)",
  "--nyte-color-avatar-violet-background":
    "light-dark(color-mix(in srgb, var(--nyte-color-hue-violet) 9%, transparent), color-mix(in srgb, var(--nyte-color-hue-violet) 17%, transparent))",
  "--nyte-color-avatar-violet-solid": "var(--nyte-color-hue-violet)",
  "--nyte-color-avatar-green-background":
    "light-dark(color-mix(in srgb, var(--nyte-color-hue-green) 9%, transparent), color-mix(in srgb, var(--nyte-color-hue-green) 17%, transparent))",
  "--nyte-color-avatar-green-foreground": "var(--nyte-color-success)",
  "--nyte-color-avatar-green-solid": "var(--nyte-color-hue-green)",
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
