import { glyphs } from "~/lib/glyphs";
import { PAGE_GLYPH_NAMES, type PageGlyphName } from "~/lib/icon-set/names";

/**
 * Glyphs by Central Icons export name, as frontmatter, meta.json, and
 * <DocCard icon="…" /> write them. Without Central, Lucide draws the same names.
 */
export const docsIcons = glyphs;

export type DocsIconName = PageGlyphName;

/** Whether a name from frontmatter or MDX names one of the docs page glyphs. */
export function hasDocsIcon(name: string): name is DocsIconName {
  return PAGE_GLYPH_NAMES.some((page) => page === name);
}
