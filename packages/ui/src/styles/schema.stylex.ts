import { defineConsts } from "@stylexjs/stylex";

import "./tokens.stylex.ts";

export const space = defineConsts({
  px: "1px",
  s0_5: "calc(var(--nyte-space-unit) * 0.5)",
  s1: "var(--nyte-space-unit)",
  s1_5: "calc(var(--nyte-space-unit) * 1.5)",
  s2: "calc(var(--nyte-space-unit) * 2)",
  s2_5: "calc(var(--nyte-space-unit) * 2.5)",
  s3: "calc(var(--nyte-space-unit) * 3)",
  s4: "calc(var(--nyte-space-unit) * 4)",
  s5: "calc(var(--nyte-space-unit) * 5)",
  s6: "calc(var(--nyte-space-unit) * 6)",
  s8: "calc(var(--nyte-space-unit) * 8)",
});

export const glyph = defineConsts({
  sm: "var(--nyte-glyph-sm)",
  md: "var(--nyte-glyph-md)",
  lg: "var(--nyte-glyph-lg)",
  box: "var(--nyte-glyph-box)",
});

export const media = defineConsts({
  hover: "@media (hover: hover) and (pointer: fine)",
});

export const target = defineConsts({
  min: "var(--nyte-target-min)",
  gap: "var(--nyte-target-gap)",
});

export const avatar = defineConsts({
  xs: "var(--nyte-avatar-xs)",
  sm: "var(--nyte-avatar-sm)",
  md: "var(--nyte-avatar-md)",
  lg: "var(--nyte-avatar-lg)",
});

export const slider = defineConsts({
  thumb: "var(--nyte-slider-thumb)",
});

export const toast = defineConsts({
  minHeight: "var(--nyte-toast-min-height)",
  paddingBlock: "var(--nyte-toast-padding-block)",
  inset: "var(--nyte-toast-inset)",
  overhang: "var(--nyte-toast-overhang)",
});

export const clipboardPreview = defineConsts({
  maxWidth: "var(--nyte-clipboard-preview-max-width)",
  maxHeight: "var(--nyte-clipboard-preview-max-height)",
});

export const button = defineConsts({
  height2xs: "var(--nyte-btn-height-2xs)",
  paddingInline2xs: "var(--nyte-btn-padding-inline-2xs)",
  pillPaddingInline2xs: "var(--nyte-btn-pill-padding-inline-2xs)",
  radius2xs: "var(--nyte-btn-radius-2xs)",
  gap2xs: "var(--nyte-btn-gap-2xs)",
  heightXs: "var(--nyte-btn-height-xs)",
  paddingInlineXs: "var(--nyte-btn-padding-inline-xs)",
  pillPaddingInlineXs: "var(--nyte-btn-pill-padding-inline-xs)",
  radiusXs: "var(--nyte-btn-radius-xs)",
  gapXs: "var(--nyte-btn-gap-xs)",
  heightSm: "var(--nyte-btn-height-sm)",
  paddingInlineSm: "var(--nyte-btn-padding-inline-sm)",
  pillPaddingInlineSm: "var(--nyte-btn-pill-padding-inline-sm)",
  radiusSm: "var(--nyte-btn-radius-sm)",
  gapSm: "var(--nyte-btn-gap-sm)",
  heightMd: "var(--nyte-btn-height-md)",
  paddingInlineMd: "var(--nyte-btn-padding-inline-md)",
  pillPaddingInlineMd: "var(--nyte-btn-pill-padding-inline-md)",
  radiusMd: "var(--nyte-btn-radius-md)",
  gapMd: "var(--nyte-btn-gap-md)",
  heightLg: "var(--nyte-btn-height-lg)",
  paddingInlineLg: "var(--nyte-btn-padding-inline-lg)",
  pillPaddingInlineLg: "var(--nyte-btn-pill-padding-inline-lg)",
  radiusLg: "var(--nyte-btn-radius-lg)",
  gapLg: "var(--nyte-btn-gap-lg)",
  heightXl: "var(--nyte-btn-height-xl)",
  paddingInlineXl: "var(--nyte-btn-padding-inline-xl)",
  pillPaddingInlineXl: "var(--nyte-btn-pill-padding-inline-xl)",
  radiusXl: "var(--nyte-btn-radius-xl)",
  gapXl: "var(--nyte-btn-gap-xl)",
  iconPaddingInline: "var(--nyte-icon-btn-padding-inline)",
});

export const input = defineConsts({
  heightMd: "var(--nyte-input-height-md)",
  insetMd: "var(--nyte-input-inset-md)",
  paddingEndMd: "var(--nyte-input-padding-end-md)",
  textareaMinHeightMd: "var(--nyte-input-textarea-min-height-md)",
  textareaPaddingBlockMd: "var(--nyte-input-textarea-padding-block-md)",
  radiusMd: "var(--nyte-input-radius-md)",
  heightLg: "var(--nyte-input-height-lg)",
  insetLg: "var(--nyte-input-inset-lg)",
  paddingEndLg: "var(--nyte-input-padding-end-lg)",
  textareaMinHeightLg: "var(--nyte-input-textarea-min-height-lg)",
  textareaPaddingBlockLg: "var(--nyte-input-textarea-padding-block-lg)",
  radiusLg: "var(--nyte-input-radius-lg)",
  heightXl: "var(--nyte-input-height-xl)",
  insetXl: "var(--nyte-input-inset-xl)",
  paddingEndXl: "var(--nyte-input-padding-end-xl)",
  textareaMinHeightXl: "var(--nyte-input-textarea-min-height-xl)",
  textareaPaddingBlockXl: "var(--nyte-input-textarea-padding-block-xl)",
  radiusXl: "var(--nyte-input-radius-xl)",
});

export const switchControl = defineConsts({
  widthMd: "var(--nyte-switch-width-md)",
  heightMd: "var(--nyte-switch-height-md)",
  paddingMd: "var(--nyte-switch-padding-md)",
  knobMd: "var(--nyte-switch-knob-md)",
});

export const checkbox = defineConsts({
  sizeMd: "var(--nyte-checkbox-size-md)",
  sizeLg: "var(--nyte-checkbox-size-lg)",
  radius: "var(--nyte-checkbox-radius)",
});

export const row = defineConsts({
  heightMd: "var(--nyte-row-height-md)",
  heightLg: "var(--nyte-row-height-lg)",
  paddingInlineMd: "var(--nyte-row-padding-inline-md)",
  paddingInlineLg: "var(--nyte-row-padding-inline-lg)",
  gap: "var(--nyte-row-gap)",
  radius: "var(--nyte-row-radius)",
});

export const menu = defineConsts({
  itemHeight: "var(--nyte-menu-item-height)",
  metaMinWidth: "var(--nyte-menu-meta-min-width)",
  padding: "var(--nyte-menu-padding)",
  radius: "var(--nyte-menu-radius)",
  itemRadius: "var(--nyte-menu-item-radius)",
  itemGap: "var(--nyte-menu-item-gap)",
  itemPaddingInline: "var(--nyte-menu-item-padding-inline)",
  itemPaddingBlock: "var(--nyte-menu-item-padding-block)",
  width: "var(--nyte-menu-width)",
  modelWidth: "var(--nyte-model-menu-width)",
  parameterWidth: "var(--nyte-parameter-menu-width)",
  maxHeight: "var(--nyte-menu-max-height)",
});

export const dialog = defineConsts({
  width: "var(--nyte-dialog-width)",
  padding: "var(--nyte-dialog-padding)",
  gap: "var(--nyte-dialog-gap)",
  radius: "var(--nyte-dialog-radius)",
});

export const layer = defineConsts({
  stickyContent: 10,
  workbench: 20,
  chrome: 30,
  sash: 31,
  menu: 60,
  submenu: 61,
  dialogBackdrop: 70,
  dialog: 71,
  tooltip: 72,
  toast: 75,
  commandBackdrop: 80,
  command: 81,
  dragPreview: 1000,
});

export const radius = defineConsts({
  indicator: "var(--nyte-shape-indicator)",
  control: "var(--nyte-shape-control)",
  card: "var(--nyte-shape-card)",
  surface: "var(--nyte-shape-surface)",
  pill: "var(--nyte-shape-pill)",
});
