/**
 * Component geometry and paint order. Components compose these named
 * decisions instead of growing their own almost-matching widths, insets, and
 * row heights. The values live in `tokens.stylex.ts`; importing this file
 * ships them.
 *
 * Every length reads a custom property rather than holding a number: a dev
 * build transforms each file alone, where a numeric const compiles to a
 * variable nothing declares there and the sizing is dropped.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/workbench-layout.stylex.ts
 */
import { defineConsts } from "@stylexjs/stylex";

import "./tokens.stylex.ts";

/**
 * One odd box, shared by the spinner and the icons that sit in the same slot.
 * The spinner's 4x4 grid of 3px squares at a 4px pitch measures 15px, and an
 * icon centred in that box lands on whole pixels, so it is named here rather
 * than rounded onto the 2px sizing grid.
 */
export const glyph = defineConsts({
  box: "var(--nyte-glyph-box)",
});

/**
 * The trailing padding that keeps toast text clear of the close button, which
 * is 24px wide at an 8px inset.
 */
export const toast = defineConsts({
  closeGutter: "var(--nyte-toast-close-gutter)",
});

export const clipboardPreview = defineConsts({
  maxWidth: "var(--nyte-clipboard-preview-max-width)",
  maxHeight: "var(--nyte-clipboard-preview-max-height)",
});

/** Notion Calendar's button sizes, 2xs to xl. An icon-only button is a square of the height. */
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
  widthSm: "var(--nyte-switch-width-sm)",
  heightSm: "var(--nyte-switch-height-sm)",
  paddingSm: "var(--nyte-switch-padding-sm)",
  knobSm: "var(--nyte-switch-knob-sm)",
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

/**
 * One menu row, shared by items, group headings, and the model picker's footer
 * item, so a popup's rows all land on the same pitch.
 */
export const menu = defineConsts({
  itemHeight: "var(--nyte-menu-item-height)",
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

/**
 * Global paint order. Ordinary component-local stacking contexts stay local;
 * only surfaces that cross feature boundaries belong here.
 */
export const layer = defineConsts({
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
