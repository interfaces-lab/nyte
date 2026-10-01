import { create } from "@stylexjs/stylex";

// Every value here is deliberate. `control-size.test.ts` asserts the exact set
// of lines the rules report.
export const styles = create({
  handSized: { height: 30 },
  handSizedGlyph: { width: 16, minHeight: 16 },
  touchFork: { minHeight: { default: 28, "@media (pointer: coarse)": 44 } },
  touchGap: { gap: { default: 2, "@media (pointer: coarse)": 8 } },
  tooSmall: { width: 12 },
  tooLarge: { minHeight: 40 },
  hairline: { height: 1 },
  fromToken: { height: "var(--nyte-btn-height-md)" },
  hoverReveal: { opacity: { default: 0, "@media (hover: none)": 1 } },
});
