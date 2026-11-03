/**
 * The raw glyph behind every icon name, from the selected set, for tests that
 * check `Icon` draws its glyph unchanged.
 */
import { FILLED_GLYPHS, GLYPHS } from "../src/glyphs/selected.generated.ts";
import {
  FILLED_ICON_NAMES,
  ICON_NAMES,
  type FilledIconName,
  type Glyph,
  type IconName,
} from "../src/icon-names.ts";

export type IconReference =
  | { readonly name: IconName; readonly outlined: Glyph }
  | { readonly name: FilledIconName; readonly outlined: Glyph; readonly filled: Glyph };

export const iconReferences: readonly IconReference[] = ICON_NAMES.map((name) => {
  const filled = FILLED_ICON_NAMES.find((candidate) => candidate === name);

  return filled === undefined
    ? { name, outlined: GLYPHS[name] }
    : { name: filled, outlined: GLYPHS[filled], filled: FILLED_GLYPHS[filled] };
});
