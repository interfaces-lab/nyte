import { defineConsts } from "@stylexjs/stylex";
import "./tokens.stylex.ts";

export const shell = defineConsts({
  titlebarHeight: "var(--nyte-titlebar-height)",
  trafficLightInset: "var(--nyte-titlebar-traffic-light-inset)",
  cardInset: "var(--nyte-shell-card-inset)",
});

export const conversation = defineConsts({
  measure: "var(--nyte-conversation-measure)",
  paragraphGap: "var(--nyte-prose-paragraph-gap)",
  gutter: "var(--nyte-conversation-gutter)",
  headerHeight: "var(--nyte-conversation-header-height)",
  turnGap: "var(--nyte-conversation-turn-gap)",
  rowGap: "var(--nyte-conversation-row-gap)",
  rowMinHeight: "var(--nyte-conversation-row-min-height)",
  edgeFade: "var(--nyte-conversation-edge-fade)",
  composerInset: "var(--nyte-composer-inset)",
  composerNewChatRadius: "var(--nyte-composer-new-chat-radius)",
  composerExpandedRadius: "var(--nyte-composer-expanded-radius)",
});

export const tray = defineConsts({
  radius: "var(--nyte-tray-radius)",
  gap: "var(--nyte-tray-gap)",
  paddingInline: "var(--nyte-tray-padding-inline)",
  headerHeight: "var(--nyte-tray-header-height)",
  rowHeight: "var(--nyte-tray-row-height)",
  rowInset: "var(--nyte-tray-row-inset)",
});

export const sidebar = defineConsts({
  width: "var(--nyte-sidebar-width)",
  handleWidth: "var(--nyte-sidebar-handle-width)",
  rowHeight: "var(--nyte-sidebar-row-height)",
  askRowHeight: "var(--nyte-sidebar-ask-row-height)",
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

export const settings = defineConsts({
  contentWidth: "var(--nyte-settings-content-width)",
  contentGutter: "var(--nyte-settings-content-gutter)",
  pagePaddingBlock: "var(--nyte-settings-page-padding-block)",
  sectionGap: "var(--nyte-settings-section-gap)",
  cardGap: "var(--nyte-settings-card-gap)",
  rowPadding: "var(--nyte-settings-row-padding)",
  rowPaddingInline: "var(--nyte-settings-row-padding-inline)",
  controlMaxWidth: "var(--nyte-settings-control-max-width)",
  pageTitleSize: "var(--nyte-settings-page-title-size)",
  pageTitleLineHeight: "var(--nyte-settings-page-title-line-height)",
  sectionTitleSize: "var(--nyte-settings-section-title-size)",
  sectionTitleLineHeight: "var(--nyte-settings-section-title-line-height)",
});

export const workbench = defineConsts({
  activeWidth: "var(--nyte-active-workbench-width)",
  railWidth: "var(--nyte-workbench-rail-width)",
  railGap: "var(--nyte-workbench-rail-gap)",
  rowGap: "var(--nyte-workbench-row-gap)",
  rowPaddingInline: "var(--nyte-workbench-row-padding-inline)",
  headingHeight: "var(--nyte-workbench-heading-height)",
  panelWidth: "var(--nyte-workbench-panel-width)",
  headerHeight: "var(--nyte-workbench-header-height)",
  headerPaddingBlock: "var(--nyte-workbench-header-padding-block)",
  iconRailWidth: "var(--nyte-workbench-icon-rail-width)",
  sashWidth: "var(--nyte-workbench-sash-width)",
  fileListWidth: "var(--nyte-workbench-file-list-width)",
  launcherCardSize: "var(--nyte-workbench-launcher-card-size)",
});

export const pane = defineConsts({
  sashSize: "var(--nyte-pane-sash-size)",
  dividerGap: "var(--nyte-pane-divider-gap)",
});

export const diffView = defineConsts({
  lineHeight: "var(--nyte-diff-line-height)",
  previewMaxHeight: "var(--nyte-diff-preview-max-height)",
});
