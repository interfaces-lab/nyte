import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { glyph } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { SymbolKind } from "./outline.ts";

const GLYPHS = {
  function: "ƒ",
  class: "C",
  type: "T",
  variable: "v",
  heading: "#",
} satisfies Record<SymbolKind, string>;

export function SymbolKindGlyph({ kind }: { readonly kind: SymbolKind }): ReactElement {
  return (
    <span aria-hidden="true" {...props(styles.glyph)}>
      {GLYPHS[kind]}
    </span>
  );
}

const styles = create({
  glyph: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: glyph.md,
    height: glyph.md,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    color: role.contentSecondary,
  },
});
