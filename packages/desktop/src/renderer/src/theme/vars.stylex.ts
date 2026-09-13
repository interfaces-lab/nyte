/**
 * Typed handles on the runtime palette owned by `tokens.css`.
 *
 * These are constants because the reference itself never changes; the CSS
 * custom property behind it does. Using `defineVars` here would emit a second,
 * hashed variable for every semantic token without adding another theme.
 *
 * Three fills cover every interactive surface, and nothing else may name one:
 * `fillGhostHover` for hover, `fillGhostSelected` for the current item, and
 * `fillSecondary` for a resting tint. A fourth name is how a hovered row ends
 * up lighter than a selected one.
 */
import * as stylex from "@stylexjs/stylex";

export const t = stylex.defineConsts({
  // text
  textPrimary: "var(--nyte-text-primary)",
  textSecondary: "var(--nyte-text-secondary)",
  textTertiary: "var(--nyte-text-tertiary)",
  textQuaternary: "var(--nyte-text-quaternary)",
  textAccent: "var(--nyte-text-accent)",
  textCyan: "var(--nyte-text-cyan-primary)",
  textSuccess: "var(--nyte-text-success)",
  textWarning: "var(--nyte-text-warning)",
  textDanger: "var(--nyte-text-danger)",
  /** Laid over `fillPrimary`, which inverts against the page. */
  textOnPrimary: "var(--nyte-text-invert)",
  /** Laid over a saturated fill, where the surface ramp does not apply. */
  textOnColor: "var(--nyte-action-label)",
  textDisabled: "var(--nyte-text-quaternary)",
  shimmerBase: "var(--nyte-text-shimmer)",
  shimmerHighlight: "var(--nyte-text-primary)",

  // icons
  iconPrimary: "var(--nyte-icon-primary)",
  iconSecondary: "var(--nyte-icon-secondary)",
  iconTertiary: "var(--nyte-icon-tertiary)",

  // surfaces
  bgBase: "var(--nyte-bg-chrome)",
  bgSubtle: "var(--nyte-bg-subtle)",
  /** A card, dialog, or toast sitting above the page, not the editor tone. */
  bgElevated: "var(--nyte-bg-raised)",
  bgScrim: "var(--nyte-bg-scrim)",
  bgEditor: "var(--nyte-bg-editor)",
  // Image transparency must not pick up the workspace tint.
  imageBg: "var(--nyte-editor-base)",
  bgCard: "var(--nyte-bg-card)",
  bgSelection: "color-mix(in srgb, var(--nyte-bg-secondary) 40%, transparent)",
  bgSidebar: "var(--nyte-sidebar-background)",

  // fills
  fillPrimary: "var(--nyte-fill-primary)",
  fillPrimaryHover: "var(--nyte-fill-primary-hover)",
  fillPrimaryDisabled: "var(--nyte-bg-secondary)",
  fillSecondary: "var(--nyte-bg-quinary)",
  fillGhostHover: "var(--nyte-bg-tertiary)",
  fillGhostSelected: "var(--nyte-bg-quaternary)",
  fillAccent: "var(--nyte-bg-accent)",
  fillAccentSubtle: "var(--nyte-bg-accent-subtle)",
  fillWarningSubtle: "var(--nyte-bg-warning-subtle)",
  fillDanger: "var(--nyte-red)",
  fillDangerHover: "var(--nyte-danger)",
  fillDangerSubtle: "var(--nyte-bg-danger-subtle)",
  switchActive: "var(--nyte-switch-active-background)",
  switchThumb: "var(--nyte-switch-thumb-background)",

  // strokes
  imageOutline: "var(--nyte-image-outline)",
  strokePrimary: "var(--nyte-stroke-primary)",
  strokeSecondary: "var(--nyte-stroke-secondary)",
  strokeTertiary: "var(--nyte-stroke-tertiary)",
  strokeQuaternary: "var(--nyte-stroke-quaternary)",
  strokeFocused: "var(--nyte-stroke-focused)",
  /** The accent ring, resolved to `transparent` while focus came from a pointer. */
  focusRing: "var(--nyte-focus-ring)",

  // status colors
  accent: "var(--nyte-accent)",
  success: "var(--nyte-success)",
  added: "var(--nyte-added)",
  removed: "var(--nyte-removed)",
  red: "var(--nyte-red)",
  green: "var(--nyte-green)",
  yellow: "var(--nyte-yellow)",
  orange: "var(--nyte-orange)",
  purple: "var(--nyte-purple)",
  cyan: "var(--nyte-cyan)",
  magenta: "var(--nyte-magenta)",
  diffAddedLineBg: "var(--nyte-diff-added-line-background)",
  diffAddedTextBg: "var(--nyte-diff-added-text-background)",
  diffRemovedLineBg: "var(--nyte-diff-removed-line-background)",
  diffRemovedTextBg: "var(--nyte-diff-removed-text-background)",

  // conversation
  conversationUserShellBg: "var(--nyte-conversation-user-shell-background)",
  conversationUserBg: "var(--nyte-conversation-user-background)",
  conversationUserBgHover: "var(--nyte-conversation-user-background-hover)",
  conversationUserRing: "var(--nyte-conversation-user-ring)",
  conversationUserRingActive: "var(--nyte-conversation-user-ring-active)",
  conversationUserShadow: "var(--nyte-conversation-user-shadow)",
  conversationTechnicalBg: "var(--nyte-conversation-technical-background)",
  conversationTechnicalRing: "var(--nyte-conversation-technical-ring)",
  conversationGuide: "var(--nyte-conversation-guide)",
  trayBg: "var(--nyte-tray-background)",
  trayShadow: "var(--nyte-tray-shadow)",
  composerBg: "var(--nyte-composer-background)",
  composerRing: "var(--nyte-composer-ring)",
  composerRingActive: "var(--nyte-composer-ring-active)",

  // shadows
  shadowControlColor: "var(--nyte-shadow-control)",
  shadowPopover: "var(--nyte-shadow-popover)",
  shadowModal: "var(--nyte-shadow-modal)",
  shadowWorkbench: "var(--nyte-shadow-workbench)",

  // type
  fontSans: "var(--nyte-font-family-sans)",
  fontMono: "var(--nyte-font-family-mono)",
  fontXs: "var(--nyte-font-size-xs)",
  fontSm: "var(--nyte-font-size-sm)",
  fontBase: "var(--nyte-font-size-base)",
  fontLg: "var(--nyte-font-size-lg)",
  font2xl: "var(--nyte-font-size-2xl)",
  fontCode: "var(--nyte-font-size-code)",
  leadingXs: "var(--nyte-line-height-xs)",
  leadingSm: "var(--nyte-line-height-sm)",
  leadingBase: "var(--nyte-line-height-base)",
  leadingLg: "var(--nyte-line-height-lg)",
  letterBase: "var(--nyte-letter-spacing-base)",
  letterLg: "var(--nyte-letter-spacing-lg)",

  // geometry
  radiusXs: "var(--nyte-radius-xs)",
  radiusSm: "var(--nyte-radius-sm)",
  radiusBase: "var(--nyte-radius-base)",
  radiusLg: "var(--nyte-radius-lg)",
  radiusXl: "var(--nyte-radius-xl)",
  radius2xl: "var(--nyte-radius-2xl)",
  radiusFull: "var(--nyte-radius-full)",

  // motion
  durationInstant: "var(--nyte-duration-instant)",
  durationFast: "var(--nyte-duration-fast)",
  durationNormal: "var(--nyte-duration-normal)",
  durationSlow: "var(--nyte-duration-slow)",
  easeOut: "var(--nyte-easing-out)",
  easeOutQuint: "var(--nyte-easing-out-quint)",
  easeInOutStrong: "var(--nyte-easing-in-out-strong)",

  // scrollbar
  scrollbarThumb: "var(--nyte-scrollbar-thumb)",
});
