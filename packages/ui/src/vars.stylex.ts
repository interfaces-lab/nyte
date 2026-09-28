/**
 * Typed handles on the palette in `tokens.stylex.ts`.
 *
 * Constants, because the reference never changes; the custom property behind
 * it does, per appearance and per workspace tint. Importing this file is also
 * what ships the token declarations wherever a handle is used.
 *
 * Three fills cover every interactive surface, and nothing else may name one:
 * `fillHover` for hover, `fillSelected` for the current item, and `fillQuiet`
 * for a resting tint. A fourth name is how a hovered row ends up lighter than
 * a selected one.
 */
import * as stylex from "@stylexjs/stylex";
import "./tokens.stylex.ts";

export const t = stylex.defineConsts({
  // text
  textPrimary: "var(--nyte-text-primary)",
  textSecondary: "var(--nyte-text-secondary)",
  textTertiary: "var(--nyte-text-tertiary)",
  textQuaternary: "var(--nyte-text-quaternary)",
  textShimmer: "var(--nyte-text-shimmer)",
  textAccent: "var(--nyte-text-accent)",
  textCyan: "var(--nyte-text-cyan)",
  textSuccess: "var(--nyte-text-success)",
  textWarning: "var(--nyte-text-warning)",
  textDanger: "var(--nyte-text-danger)",
  /** Laid over `fillInverse`, which inverts against the page. */
  textOnInverse: "var(--nyte-text-on-inverse)",
  /** Laid over a saturated fill, where the ink ramp does not apply. */
  textOnColor: "var(--nyte-text-on-color)",

  // icons
  iconPrimary: "var(--nyte-icon-primary)",
  iconSecondary: "var(--nyte-icon-secondary)",
  iconTertiary: "var(--nyte-icon-tertiary)",

  // surfaces
  bgPage: "var(--nyte-bg-page)",
  bgSidebar: "var(--nyte-bg-sidebar)",
  /** A card, dialog, or toast sitting above the page. */
  bgRaised: "var(--nyte-bg-raised)",
  bgScrim: "var(--nyte-bg-scrim)",
  /** Behind image transparency, which must not pick up the workspace tint. */
  imageBg: "var(--nyte-page-base)",
  materialBg: "var(--nyte-material-bg)",
  materialFilter: "var(--nyte-material-filter)",

  // fills
  fillHover: "var(--nyte-fill-hover)",
  fillSelected: "var(--nyte-fill-selected)",
  fillQuiet: "var(--nyte-fill-quiet)",
  fillStrong: "var(--nyte-fill-strong)",
  fillInverse: "var(--nyte-fill-inverse)",
  fillAccentSubtle: "var(--nyte-fill-accent-subtle)",
  fillSuccessSubtle: "var(--nyte-fill-success-subtle)",
  fillWarningSubtle: "var(--nyte-fill-warning-subtle)",
  fillDanger: "var(--nyte-red)",
  fillDangerSubtle: "var(--nyte-fill-danger-subtle)",
  /** `backgroundImage` layers, so a fill keeps its own colour under hover and press. */
  layerHover: "var(--nyte-layer-hover)",
  layerPressed: "var(--nyte-layer-pressed)",
  buttonSecondaryBg: "var(--nyte-button-secondary-bg)",
  switchThumb: "var(--nyte-switch-thumb)",

  // interaction
  /** The cursor over anything clickable: `pointer`, or the arrow when the host opts out. */
  cursorInteractive: "var(--nyte-cursor-interactive)",

  // strokes
  strokePrimary: "var(--nyte-stroke-primary)",
  strokeSecondary: "var(--nyte-stroke-secondary)",
  strokeTertiary: "var(--nyte-stroke-tertiary)",
  strokeFocused: "var(--nyte-stroke-focused)",
  /** The accent ring, resolved to `transparent` while focus came from a pointer. */
  focusRing: "var(--nyte-focus-ring)",
  imageOutline: "var(--nyte-image-outline)",
  /** Selected text, in the page and in the terminal. */
  selection: "var(--nyte-selection)",

  // hues
  accent: "var(--nyte-accent)",
  red: "var(--nyte-red)",
  green: "var(--nyte-green)",
  yellow: "var(--nyte-yellow)",
  orange: "var(--nyte-orange)",
  purple: "var(--nyte-purple)",
  cyan: "var(--nyte-cyan)",
  magenta: "var(--nyte-magenta)",
  /** The workspace tint at full strength, for the appearance swatch. */
  tintSwatch: "var(--nyte-tint-swatch)",

  // diffs
  diffAdded: "var(--nyte-green)",
  diffRemoved: "var(--nyte-text-danger)",
  diffAddedLineBg: "var(--nyte-diff-added-line-bg)",
  diffAddedTextBg: "var(--nyte-diff-added-text-bg)",
  diffRemovedLineBg: "var(--nyte-diff-removed-line-bg)",
  diffRemovedTextBg: "var(--nyte-diff-removed-text-bg)",

  // conversation
  conversationUserShellBg: "var(--nyte-conversation-user-shell-bg)",
  conversationUserBg: "var(--nyte-conversation-user-bg)",
  conversationUserRing: "var(--nyte-conversation-user-ring)",
  conversationUserRingActive: "var(--nyte-conversation-user-ring-active)",
  conversationUserShadow: "var(--nyte-conversation-user-shadow)",
  conversationTechnicalBg: "var(--nyte-conversation-technical-bg)",
  conversationTechnicalRing: "var(--nyte-conversation-technical-ring)",
  conversationGuide: "var(--nyte-conversation-guide)",
  composerBg: "var(--nyte-composer-bg)",
  composerRing: "var(--nyte-composer-ring)",
  composerRingActive: "var(--nyte-composer-ring-active)",

  // shadows
  shadowColor: "var(--nyte-shadow-color)",
  shadowControlColor: "var(--nyte-shadow-control-color)",
  shadowButton: "var(--nyte-shadow-button)",
  shadowPopover: "var(--nyte-shadow-popover)",
  shadowModal: "var(--nyte-shadow-modal)",
  shadowWorkbench: "var(--nyte-shadow-workbench)",
  trayShadow: "var(--nyte-tray-shadow)",

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
