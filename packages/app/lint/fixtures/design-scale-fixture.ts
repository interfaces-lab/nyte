import { create } from "@stylexjs/stylex";

// Every value here is deliberate. `design-scale.test.ts` asserts the exact set
// of lines the rules report, so edit the test when you edit this file.
const ink = "var(--nyte-content-primary)";

export const fixtureStyles = create({
  tokenized: { gap: ink, marginInline: "auto", paddingInline: "1em", marginBlockStart: 0 },
  onScale: { gap: 8, paddingInline: 12 },
  negativeOnScale: { marginTop: -4 },
  offScale: { gap: 7, paddingBlock: 9 },
  aboveScale: { paddingInlineStart: 96 },
  negative: { marginInline: -5 },
  condition: { gap: { default: 0, ":hover": 5 } },
  pseudo: { "::after": { paddingInline: 3 } },
  shorthandString: { padding: "5px 10px" },
  mixedShorthand: { margin: "8px auto" },
  computedString: { padding: "calc(100% - 3px)", width: "min(608px, 100%)" },
  sizes: { width: 28, minHeight: 24 },
  hairline: { width: 1, height: 1.5 },
  offGridSize: { width: 15, minHeight: 61 },
  // Not a length: a stacking order, a count, and a ratio are not on the grid.
  notLengths: { zIndex: 9, flexGrow: 3, opacity: 0.5, lineHeight: 15 },
  // A style may be named after a property without governing what is inside it.
  gap: { zIndex: 7, fontSize: 13 },
  rawWeight: { fontWeight: 600 },
  stringWeight: { fontWeight: { default: "500", ":hover": 400 } },
  offTokenWeight: { fontWeight: 700 },
  handleWeight: { fontWeight: "var(--nyte-font-weight-medium)", fontStyle: "normal" },
  keywordWeight: { fontWeight: "bold" },
  lightDark: { color: "light-dark(#000, #fff)" },
  lightDarkTemplate: { backgroundColor: { ":hover": `light-dark(${ink}, transparent)` } },
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

export const measurement = { gap: 7, width: 15, fontWeight: 600, color: "light-dark(red, blue)" };
