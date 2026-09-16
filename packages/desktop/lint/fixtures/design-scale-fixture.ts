import { create } from "@stylexjs/stylex";
import * as stylex from "@stylexjs/stylex";

// Every value here is deliberate. `design-scale.test.ts` asserts the exact set
// of lines the rules report, so edit the test when you edit this file.
export const fixtureStyles = stylex.create({
  onScale: { gap: 8, paddingInline: 12, marginBlockStart: 0, width: 28, minHeight: 24 },
  offScale: { gap: 7, paddingBlock: 9 },
  aboveScale: { paddingInlineStart: 96 },
  negative: { marginInline: -5 },
  condition: { gap: { default: 8, ":hover": 5 } },
  pseudo: { "::after": { paddingInline: 3 } },
  shorthandString: { padding: "5px 10px" },
  computedString: { padding: "calc(100% - 3px)", width: "min(608px, 100%)" },
  hairline: { width: 1, height: 1.5 },
  offGridSize: { width: 15, minHeight: 61 },
  // Not a length: a stacking order, a count, and a ratio are not on the grid.
  notLengths: { zIndex: 9, flexGrow: 3, opacity: 0.5, lineHeight: 15 },
  // A style may be named after a property without governing what is inside it.
  gap: { zIndex: 7, fontSize: 13 },
});

// The bare `create` import is the more common form in the renderer.
export const bareStyles = create({
  bare: { gap: 7 },
  blockBody: (inset: number) => {
    return { paddingInline: 3, marginInline: inset };
  },
});

// Known holes, asserted as silent so a future fix is a visible test change:
// a value the compiler resolves rather than the linter, and a plain object.
const SPACING = 7;
export const unreadable = create({ indirect: { gap: SPACING } });
export const measurement = { gap: 7, width: 15 };
