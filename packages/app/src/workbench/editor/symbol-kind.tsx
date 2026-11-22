import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import type { CompletionKind } from "@nyte-ai/schema";
import { glyph } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { SymbolKind } from "./outline.ts";

const GLYPHS = {
  function: "ƒ",
  class: "C",
  type: "T",
  variable: "v",
  heading: "#",
  text: "a",
  method: "m",
  constructor: "ƒ",
  field: "f",
  interface: "I",
  module: "M",
  property: "p",
  unit: "u",
  value: "1",
  enum: "E",
  keyword: "k",
  snippet: "s",
  color: "c",
  file: "F",
  reference: "r",
  folder: "/",
  enumMember: "e",
  constant: "K",
  struct: "S",
  event: "!",
  operator: "+",
  typeParameter: "T",
} satisfies Record<SymbolKind | CompletionKind, string>;

export function SymbolKindGlyph({
  kind,
}: {
  readonly kind: SymbolKind | CompletionKind;
}): ReactElement {
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
