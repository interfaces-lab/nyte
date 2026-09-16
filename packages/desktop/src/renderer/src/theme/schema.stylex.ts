/**
 * Desktop geometry schema. Components compose these named decisions instead
 * of growing their own almost-matching widths, insets, and row heights.
 * Runtime appearance belongs in CSS variables; structural geometry stays
 * static so StyleX can evaluate it once.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/workbench-layout.stylex.ts
 */
import * as stylex from "@stylexjs/stylex";

export const shell = stylex.defineConsts({
  titlebarHeight: "var(--nyte-titlebar-height)",
  /** macOS reserves this lane for the traffic lights at 100% zoom. */
  trafficLightInset: "var(--nyte-titlebar-traffic-light-inset)",
});

export const conversation = stylex.defineConsts({
  measure: "var(--nyte-conversation-measure)",
  proseMeasure: "var(--nyte-prose-measure)",
  gutter: "var(--nyte-conversation-gutter)",
  headerHeight: "var(--nyte-conversation-header-height)",
  turnGap: "var(--nyte-conversation-turn-gap)",
  rowGap: "var(--nyte-conversation-row-gap)",
  rowMinHeight: "var(--nyte-conversation-row-min-height)",
  /**
   * How far a row dissolves at a scrollport edge: the strip above the composer
   * and the transcript's own top fade. Cursor uses `--cursor-spacing-8` for
   * the same pair.
   */
  edgeFade: "var(--nyte-conversation-edge-fade)",
  composerInset: "var(--nyte-composer-inset)",
  composerNewChatRadius: "var(--nyte-composer-new-chat-radius)",
  composerExpandedRadius: "var(--nyte-composer-expanded-radius)",
});

export const tray = stylex.defineConsts({
  radius: "var(--nyte-tray-radius)",
  gap: "var(--nyte-tray-gap)",
  paddingInline: "var(--nyte-tray-padding-inline)",
  headerHeight: "var(--nyte-tray-header-height)",
  rowHeight: "var(--nyte-tray-row-height)",
  rowInset: "var(--nyte-tray-row-inset)",
  lineHeight: "var(--nyte-tray-line-height)",
});

export const sidebar = stylex.defineConsts({
  width: "var(--nyte-sidebar-width)",
  handleWidth: "var(--nyte-sidebar-handle-width)",
  rowHeight: "var(--nyte-sidebar-row-height)",
  gutter: "var(--nyte-sidebar-gutter)",
  rowPaddingInline: "var(--nyte-sidebar-row-padding-inline)",
  rowGap: "var(--nyte-sidebar-row-gap)",
  sectionGap: "var(--nyte-sidebar-section-gap)",
  listGap: "var(--nyte-sidebar-list-gap)",
  iconSlot: "var(--nyte-sidebar-icon-slot)",
  actionSize: "var(--nyte-sidebar-action-size)",
  trailingWidth: "var(--nyte-sidebar-trailing-width)",
  metaWidth: "var(--nyte-sidebar-meta-width)",
});

export const settings = stylex.defineConsts({
  contentWidth: "var(--nyte-settings-content-width)",
  contentGutter: "var(--nyte-settings-content-gutter)",
  rowMinHeight: "var(--nyte-settings-row-min-height)",
  sliderRowMinHeight: "var(--nyte-settings-slider-row-min-height)",
  sectionGap: "var(--nyte-settings-section-gap)",
  cardGap: "var(--nyte-settings-card-gap)",
  rowPadding: "var(--nyte-settings-row-padding)",
  controlHeight: "var(--nyte-settings-control-height)",
  controlMaxWidth: "var(--nyte-settings-control-max-width)",
  pageTitleSize: "var(--nyte-settings-page-title-size)",
  pageTitleLineHeight: "var(--nyte-settings-page-title-line-height)",
  /** A section heading, which stands taller than the rows beneath it. */
  headingHeight: "var(--nyte-settings-heading-height)",
});

export const workbench = stylex.defineConsts({
  railWidth: "var(--nyte-workbench-rail-width)",
  panelWidth: "var(--nyte-workbench-panel-width)",
  headerHeight: "var(--nyte-workbench-header-height)",
  fileListWidth: "var(--nyte-workbench-file-list-width)",
});

export const pane = stylex.defineConsts({
  /**
   * The drag lane on a pane divider. It centres a 1px line, so the track stays
   * odd; an even one would land the hairline on a half pixel.
   */
  sashSize: "var(--nyte-pane-sash-size)",
  /** Holds the suggestion divider on the same footing: an odd gap, a centred line. */
  dividerGap: "var(--nyte-pane-divider-gap)",
});

/**
 * One odd box, shared by the spinner and the icons that sit in the same slot.
 * The spinner's 4x4 grid of 3px squares at a 4px pitch measures 15px, and an
 * icon centred in that box lands on whole pixels, so it is named here rather
 * than rounded onto the 2px sizing grid.
 *
 * It reads a custom property rather than holding the number, because a dev
 * build transforms each file alone: a numeric const compiles to a variable
 * nothing declares there, and the sizing is dropped.
 */
export const glyph = stylex.defineConsts({
  box: "var(--nyte-glyph-box)",
});

/**
 * The trailing padding that keeps toast text clear of the close button, which
 * is 24px wide at an 8px inset.
 */
export const toast = stylex.defineConsts({
  closeGutter: "var(--nyte-toast-close-gutter)",
});

export const diffView = stylex.defineConsts({
  lineHeight: "var(--nyte-diff-line-height)",
  previewMaxHeight: "var(--nyte-diff-preview-max-height)",
});

export const clipboardPreview = stylex.defineConsts({
  maxWidth: "var(--nyte-clipboard-preview-max-width)",
  maxHeight: "var(--nyte-clipboard-preview-max-height)",
});

export const control = stylex.defineConsts({
  sectionGap: "var(--nyte-section-gap)",
});

/**
 * One menu row, shared by items, group headings, and the model picker's footer
 * item, so a popup's rows all land on the same pitch.
 *
 * Every value reads a custom property rather than holding a number: a dev build
 * transforms each file alone, where a numeric const compiles to a variable
 * nothing declares there and the sizing is dropped.
 */
export const menu = stylex.defineConsts({
  itemHeight: "var(--nyte-menu-item-height)",
  width: "var(--nyte-menu-width)",
  modelWidth: "var(--nyte-model-menu-width)",
  parameterWidth: "var(--nyte-parameter-menu-width)",
  maxHeight: "var(--nyte-menu-max-height)",
});

/**
 * Global paint order. Ordinary component-local stacking contexts stay local;
 * only surfaces that cross feature boundaries belong here.
 */
export const layer = stylex.defineConsts({
  stickyContent: 10,
  workbench: 20,
  chrome: 30,
  menu: 60,
  submenu: 61,
  tooltip: 70,
  dialogBackdrop: 70,
  dialog: 71,
  toast: 75,
  commandBackdrop: 80,
  command: 81,
  dragPreview: 1000,
});
