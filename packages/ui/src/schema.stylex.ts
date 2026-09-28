/**
 * Component geometry and paint order. Components compose these named
 * decisions instead of growing their own almost-matching widths, insets, and
 * row heights. The values live in `tokens.stylex.ts`; importing this file
 * ships them.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/workbench-layout.stylex.ts
 */
import * as stylex from "@stylexjs/stylex";
import "./tokens.stylex.ts";

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

export const clipboardPreview = stylex.defineConsts({
  maxWidth: "var(--nyte-clipboard-preview-max-width)",
  maxHeight: "var(--nyte-clipboard-preview-max-height)",
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

export const dialog = stylex.defineConsts({
  width: "var(--nyte-dialog-width)",
  padding: "var(--nyte-dialog-padding)",
  gap: "var(--nyte-dialog-gap)",
  radius: "var(--nyte-dialog-radius)",
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
