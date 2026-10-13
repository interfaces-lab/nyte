import { TextBuffer } from "@opentui/core";
import type { NativeResourceOwner, WidthMethod } from "@opentui/core";
import stringWidth from "string-width";

const segmenter = new Intl.Segmenter();

/** Unicode display width for chrome, not native editor offsets. */
export function displayWidth(text: string): number {
  return stringWidth(text);
}

export function padDisplay(text: string, width: number): string {
  const room = width - displayWidth(text);

  return room > 0 ? text + " ".repeat(room) : text;
}

/** Cut at grapheme boundaries so a double-width cell is never split. */
export function truncateDisplay(text: string, width: number, ellipsis = ""): string {
  if (displayWidth(text) <= width) return text;
  const budget = Math.max(0, width - displayWidth(ellipsis));
  let kept = "";
  let used = 0;

  for (const { segment: grapheme } of segmenter.segment(text)) {
    const cells = displayWidth(grapheme);

    if (used + cells > budget) break;
    kept += grapheme;
    used += cells;
  }

  return `${kept}${displayWidth(ellipsis) <= width ? ellipsis : ""}`;
}
/** Measure a string prefix in the editor's native cell space; `owner` holds the scratch buffer. */
export function cellOffset(
  text: string,
  index: number,
  widthMethod: WidthMethod,
  tabWidth: number,
  owner: NativeResourceOwner,
): number {
  const prefix = text.slice(0, index);

  // Markers and ordinary ASCII need neither a native allocation nor segmentation.
  if (/^[\x20-\x7e\n]*$/.test(prefix)) return prefix.length;
  // Render-buffer encodeUnicode caps packed grapheme widths. Editor offsets
  // need the uncapped width, notably for ZWJ emoji under wcwidth.
  const buffer = TextBuffer.create(widthMethod, owner);

  try {
    buffer.setTabWidth(tabWidth);
    buffer.setText(prefix);

    return buffer.length + buffer.getLineCount() - 1;
  } finally {
    buffer.destroy();
  }
}
