/**
 * Typed handles on the runtime palette owned by `tokens.css`.
 *
 * These are constants because the reference itself never changes; the CSS
 * custom property behind it does. Using `defineVars` here would emit a second,
 * hashed variable for every semantic token without adding another theme.
 */
import * as stylex from "@stylexjs/stylex";

export const t = stylex.defineConsts({
  // text
  textPrimary: "var(--nyte-text-primary)",
  textSecondary: "var(--nyte-text-secondary)",
  textTertiary: "var(--nyte-text-tertiary)",
  textQuaternary: "var(--nyte-text-quaternary)",
  textInvert: "var(--nyte-text-invert)",
  textAccent: "var(--sand-text-accent)",
  textCyan: "var(--nyte-text-cyan-primary)",
  textSuccess: "var(--sand-text-success)",
  textWarning: "var(--sand-text-warning)",
  textDanger: "var(--sand-text-danger)",
  textOnPrimary: "var(--sand-text-on-primary)",
  textOnColor: "var(--sand-text-on-color)",
  textDisabled: "var(--sand-text-disabled)",
  shimmerBase: "var(--sand-text-shimmer-base)",
  shimmerHighlight: "var(--sand-text-shimmer-highlight)",

  // icons
  iconPrimary: "var(--nyte-icon-primary)",
  iconSecondary: "var(--nyte-icon-secondary)",
  iconTertiary: "var(--nyte-icon-tertiary)",

  // surfaces
  bgBase: "var(--sand-bg-base)",
  bgSubtle: "var(--sand-bg-subtle)",
  bgElevated: "var(--sand-bg-elevated)",
  bgScrim: "var(--sand-bg-scrim)",
  bgChrome: "var(--nyte-bg-chrome)",
  bgEditor: "var(--nyte-bg-editor)",
  // Image transparency must not pick up the workspace tint.
  imageBg: "var(--nyte-editor-base)",
  bgCard: "var(--nyte-bg-card)",
  bgHover: "var(--nyte-bg-tertiary)",
  bgActive: "var(--nyte-bg-secondary)",
  bgFaint: "var(--nyte-bg-quinary)",
  bgSelection: "color-mix(in srgb, var(--nyte-bg-secondary) 40%, transparent)",
  bgSidebar: "var(--nyte-sidebar-background)",

  // fills
  fillPrimary: "var(--sand-fill-primary)",
  fillPrimaryHover: "var(--sand-fill-primary-hover)",
  fillPrimaryDisabled: "var(--sand-fill-primary-disabled)",
  fillSecondary: "var(--sand-fill-secondary)",
  fillSecondaryHover: "var(--sand-fill-secondary-hover)",
  fillGhostHover: "var(--sand-fill-ghost-hover)",
  fillGhostSelected: "var(--sand-fill-ghost-selected)",
  fillElevated: "var(--sand-fill-elevated)",
  fillBubbleAgent: "var(--sand-fill-bubble-agent)",
  fillBubbleUser: "var(--sand-fill-bubble-user)",
  fillAccent: "var(--sand-fill-accent)",
  fillAccentHover: "var(--sand-fill-accent-hover)",
  fillAccentSubtle: "var(--sand-fill-accent-subtle)",
  fillSuccess: "var(--sand-fill-success)",
  fillSuccessSubtle: "var(--sand-fill-success-subtle)",
  fillWarning: "var(--sand-fill-warning)",
  fillWarningSubtle: "var(--sand-fill-warning-subtle)",
  fillDanger: "var(--sand-fill-danger)",
  fillDangerHover: "var(--sand-fill-danger-hover)",
  fillDangerSubtle: "var(--sand-fill-danger-subtle)",
  switchActive: "var(--nyte-switch-active-background)",
  switchThumb: "var(--nyte-switch-thumb-background)",

  // borders
  borderSubtle: "var(--sand-border-subtle)",
  imageOutline: "var(--nyte-image-outline)",
  borderWeak: "var(--sand-border-weak)",
  borderDefault: "var(--sand-border-default)",
  borderStrong: "var(--sand-border-strong)",
  borderFocus: "var(--sand-border-focus)",
  borderAccent: "var(--sand-border-accent)",
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
  warn: "var(--nyte-warn)",
  danger: "var(--nyte-danger)",
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
  conversationTechnicalBg: "var(--nyte-conversation-technical-background)",
  conversationTechnicalRing: "var(--nyte-conversation-technical-ring)",
  conversationGuide: "var(--nyte-conversation-guide)",
  composerBg: "var(--nyte-composer-background)",
  composerRing: "var(--nyte-composer-ring)",
  composerRingActive: "var(--nyte-composer-ring-active)",

  // shadows
  shadowControlColor: "var(--sand-shadow-control)",
  shadowPopover: "var(--sand-shadow-popover)",
  shadowModal: "var(--sand-shadow-modal)",
  shadowWorkbench: "var(--sand-shadow-workbench)",

  // type
  fontSans: "var(--nyte-font-family-sans)",
  fontMono: "var(--nyte-font-family-mono)",
  fontXs: "var(--nyte-font-size-xs)",
  fontSm: "var(--nyte-font-size-sm)",
  fontBase: "var(--nyte-font-size-base)",
  fontLg: "var(--nyte-font-size-lg)",
  fontXl: "var(--nyte-font-size-xl)",
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
  radius3xl: "var(--nyte-radius-3xl)",
  radius4xl: "var(--nyte-radius-4xl)",
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
  scrollbarThumbHover: "var(--nyte-scrollbar-thumb-hover)",
});
