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
});

export const conversation = stylex.defineConsts({
  measure: "var(--nyte-conversation-measure)",
  proseMeasure: "var(--nyte-prose-measure)",
  gutter: "var(--nyte-conversation-gutter)",
  headerHeight: "var(--nyte-conversation-header-height)",
  turnGap: "var(--nyte-conversation-turn-gap)",
  rowGap: "var(--nyte-conversation-row-gap)",
  rowMinHeight: "var(--nyte-conversation-row-min-height)",
  composerInset: "var(--nyte-composer-inset)",
  composerNewChatRadius: "var(--nyte-composer-new-chat-radius)",
  composerExpandedRadius: "var(--nyte-composer-expanded-radius)",
});

export const sidebar = stylex.defineConsts({
  width: "var(--nyte-sidebar-width)",
  handleWidth: "var(--nyte-sidebar-handle-width)",
  rowHeight: "var(--nyte-compact-row-height)",
  gutter: "var(--nyte-sidebar-gutter)",
  rowPaddingInline: "var(--nyte-sidebar-row-padding-inline)",
  rowGap: "var(--nyte-sidebar-row-gap)",
  sectionGap: "var(--nyte-sidebar-section-gap)",
  listGap: "var(--nyte-sidebar-list-gap)",
  iconSlot: "var(--nyte-sidebar-icon-slot)",
  actionSize: "var(--nyte-sidebar-action-size)",
  trailingWidth: "var(--nyte-sidebar-trailing-width)",
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
});

export const workbench = stylex.defineConsts({
  railWidth: "var(--nyte-workbench-rail-width)",
  panelWidth: "var(--nyte-workbench-panel-width)",
  headerHeight: "var(--nyte-workbench-header-height)",
  fileListWidth: "var(--nyte-workbench-file-list-width)",
});

export const diffView = stylex.defineConsts({
  lineHeight: "var(--nyte-diff-line-height)",
  previewMaxHeight: "var(--nyte-diff-preview-max-height)",
});

export const control = stylex.defineConsts({
  compactHeight: "var(--nyte-control-compact-height)",
  regularHeight: "var(--nyte-control-regular-height)",
  menuWidth: "var(--nyte-menu-width)",
  modelMenuWidth: "var(--nyte-model-menu-width)",
  parameterMenuWidth: "var(--nyte-parameter-menu-width)",
  menuMaxHeight: "var(--nyte-menu-max-height)",
  sectionGap: "var(--nyte-section-gap)",
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
