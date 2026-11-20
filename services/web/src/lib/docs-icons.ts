import { glyphs } from "~/lib/glyphs";
import { PAGE_GLYPH_NAMES, type PageGlyphName } from "~/lib/icon-set/names";

export const docsIcons = glyphs;

export type DocsIconName = PageGlyphName;

export function hasDocsIcon(name: string): name is DocsIconName {
  return PAGE_GLYPH_NAMES.some((page) => page === name);
}
