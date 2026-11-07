import { create } from "@stylexjs/stylex";

import { media } from "./schema.stylex.ts";
import { role } from "./vars.stylex.ts";

const ELEVATION = "var(--nyte-hairline-elevation, 0 0 #0000)";

const FORCED_BLOCK_START =
  "linear-gradient(CanvasText, CanvasText) 1 0 0 0 / 1px 0 0 0 / 0 stretch";

const FORCED_BLOCK_END = "linear-gradient(CanvasText, CanvasText) 0 0 1 0 / 0 0 1px 0 / 0 stretch";

const FORCED_LEFT = "linear-gradient(CanvasText, CanvasText) 0 0 0 1 / 0 0 0 1px / 0 stretch";

const FORCED_RIGHT = "linear-gradient(CanvasText, CanvasText) 0 1 0 0 / 0 1px 0 0 / 0 stretch";

export const hairline = create({
  blockStart: {
    boxShadow: `${ELEVATION}, inset 0 1px 0 ${role.strokeQuaternary}`,
    borderImage: { default: null, [media.forcedColors]: FORCED_BLOCK_START },
  },
  blockEnd: {
    boxShadow: `${ELEVATION}, inset 0 -1px 0 ${role.strokeQuaternary}`,
    borderImage: { default: null, [media.forcedColors]: FORCED_BLOCK_END },
  },
  inlineStart: {
    boxShadow: {
      default: `${ELEVATION}, inset 1px 0 0 ${role.strokeQuaternary}`,
      ":dir(rtl)": `${ELEVATION}, inset -1px 0 0 ${role.strokeQuaternary}`,
    },
    borderImage: {
      default: null,
      [media.forcedColors]: { default: FORCED_LEFT, ":dir(rtl)": FORCED_RIGHT },
    },
  },
  tableCell: {
    "--_hairline-dir": { default: "1", ":dir(rtl)": "-1" },
    "--_hairline-block-end": { default: "1px", ":is(tbody > tr:last-child > *)": "0px" },
    "--_hairline-inline-end": { default: "1px", ":last-child": "0px" },
    boxShadow: `${ELEVATION}, inset 0 calc(-1 * var(--_hairline-block-end)) 0 ${role.strokeQuaternary}, inset calc(-1 * var(--_hairline-dir) * var(--_hairline-inline-end)) 0 0 ${role.strokeQuaternary}`,
    borderImage: {
      default: null,
      [media.forcedColors]:
        "linear-gradient(CanvasText, CanvasText) 1 / 0 calc(var(--_hairline-inline-end) * max(0, var(--_hairline-dir))) var(--_hairline-block-end) calc(var(--_hairline-inline-end) * max(0, -1 * var(--_hairline-dir))) / 0 stretch",
    },
  },
  ringAfter: {
    boxShadow: ELEVATION,
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 1px ${role.strokeQuaternary}`,
      borderWidth: { default: 0, [media.forcedColors]: 1 },
      borderStyle: "solid",
      borderColor: { default: "transparent", [media.forcedColors]: "CanvasText" },
      pointerEvents: "none",
    },
  },
  controlRing: {
    boxShadow: `${ELEVATION}, inset 0 0 0 1px ${role.strokeTertiary}`,
    "::after": {
      content: { default: null, [media.forcedColors]: '""' },
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: "CanvasText",
      pointerEvents: "none",
    },
    ":focus-visible::after": { borderColor: "Highlight" },
  },
  pressedRing: {
    "[data-pressed]::after": {
      content: { default: null, [media.forcedColors]: '""' },
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: "Highlight",
      pointerEvents: "none",
    },
  },
  ring: {
    boxShadow: `${ELEVATION}, inset 0 0 0 1px ${role.strokeQuaternary}`,
    outlineStyle: { default: null, [media.forcedColors]: "solid" },
    outlineWidth: { default: null, [media.forcedColors]: 1 },
    outlineColor: { default: null, [media.forcedColors]: "CanvasText" },
    outlineOffset: { default: null, [media.forcedColors]: -1 },
  },
});
