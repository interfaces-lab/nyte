import { getTreeSitterClient } from "@opentui/core";
import type { SimpleHighlight } from "@opentui/core";

const MAX_CHARS = 2000;

const NONE: readonly SimpleHighlight[] = [];

/** Tree-sitter's highlight ranges for one label; none for a blank or long label, or when the parser fails. */
export async function labelHighlights(
  text: string,
  filetype: string,
): Promise<readonly SimpleHighlight[]> {
  if (text === "" || text.length > MAX_CHARS) return NONE;

  return getTreeSitterClient()
    .highlightOnce(text, filetype)
    .then(
      (result) => result.highlights ?? NONE,
      () => NONE,
    );
}
