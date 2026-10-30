import { create } from "@stylexjs/stylex";

import { type } from "./vars.stylex.ts";

export const text = create({
  xs: { fontSize: type.fontXs, lineHeight: type.leadingXs, letterSpacing: type.letterBase },
  sm: { fontSize: type.fontSm, lineHeight: type.leadingSm, letterSpacing: type.letterBase },
  base: { fontSize: type.fontBase, lineHeight: type.leadingBase, letterSpacing: type.letterBase },
  baseCompact: {
    fontSize: type.fontBase,
    lineHeight: type.leadingSm,
    letterSpacing: type.letterBase,
  },
  lg: { fontSize: type.fontLg, lineHeight: type.leadingLg, letterSpacing: type.letterLg },
  xl: { fontSize: type.fontXl, lineHeight: type.leadingXl, letterSpacing: type.letterLg },
  "2xl": { fontSize: type.font2xl, lineHeight: type.leading2xl, letterSpacing: type.letterLg },
  "3xl": { fontSize: type.font3xl, lineHeight: type.leading3xl, letterSpacing: type.letterLg },
  code: {
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingCode,
    letterSpacing: "normal",
  },
});
