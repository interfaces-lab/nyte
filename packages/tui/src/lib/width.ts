import { TextBuffer } from "@opentui/core";
import type { NativeResourceOwner, WidthMethod } from "@opentui/core";
import stringWidth from "string-width";

const segmenter = new Intl.Segmenter();

export function displayWidth(text: string): number {
  return stringWidth(text);
}

export function padDisplay(text: string, width: number): string {
  const room = width - displayWidth(text);

  return room > 0 ? text + " ".repeat(room) : text;
}

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
export function cellOffset(
  text: string,
  index: number,
  widthMethod: WidthMethod,
  tabWidth: number,
  owner: NativeResourceOwner,
): number {
  const prefix = text.slice(0, index);

  if (/^[\x20-\x7e\n]*$/.test(prefix)) return prefix.length;
  const buffer = TextBuffer.create(widthMethod, owner);

  try {
    buffer.setTabWidth(tabWidth);
    buffer.setText(prefix);

    return buffer.length + buffer.getLineCount() - 1;
  } finally {
    buffer.destroy();
  }
}
