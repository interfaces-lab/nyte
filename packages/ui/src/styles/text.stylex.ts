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
  code: {
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: type.leadingCode,
    letterSpacing: "normal",
  },
});
