/**
 * Stacked Changes geometry. Heights come from Pretext (or an injected
 * measure) so jump-to-file and scroll-spy never read offsetTop.
 */
import { parsePatch } from "diff";

/** 36px header + 1px rule, 52px after the last file. */
export const STACKED_HEADER_HEIGHT = 37;
export const STACKED_LIST_PADDING_END = 52;
export const STACKED_DIFF_LINE_HEIGHT = 20;
export const STACKED_NOTICE_PADDING = 20;
const STACKED_GUTTER_PAD = 8;
const STACKED_INDICATOR = 12;
const STACKED_OVERSCAN = 800;

export const MISSING_WORKING_TREE =
  "This file changed during the conversation but is no longer different in the working tree.";
const FAILED_PATCH = "The patch could not be read.";
export const EMPTY_PATCH = "No text diff is available for this file.";

export type ChangeStackSection =
  | { readonly kind: "diff"; readonly path: string; readonly patch: string }
  | { readonly kind: "raw"; readonly path: string; readonly text: string }
  | { readonly kind: "notice"; readonly path: string; readonly text: string }
  | { readonly kind: "pending"; readonly path: string };

export type UncommittedPatch =
  | { readonly kind: "absent" }
  | { readonly kind: "pending" }
  | { readonly kind: "failed" }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly patch: string };

export interface StackedOffset {
  readonly path: string;
  readonly top: number;
  readonly height: number;
}

export function stackedPatchLines(patch: string): readonly string[] {
  let files;
  try {
    files = parsePatch(patch);
  } catch {
    return patch.split("\n");
  }
  if (files.length === 0) {
    return patch.split("\n").filter((line) => !line.startsWith("--- ") && !line.startsWith("+++ "));
  }
  const lines: string[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      lines.push(
        `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
      );
      for (const raw of hunk.lines) {
        lines.push(raw.length > 0 ? raw.slice(1) : "");
      }
    }
  }
  return lines;
}

export function stackedGutterWidth(digitWidth: number): number {
  return digitWidth + STACKED_GUTTER_PAD + STACKED_INDICATOR;
}

export function stackedSectionHeight({
  section,
  contentWidth,
  measureHeight,
}: {
  readonly section: ChangeStackSection;
  readonly contentWidth: number;
  readonly measureHeight: (text: string, maxWidth: number) => number;
}): number {
  switch (section.kind) {
    case "pending":
      return STACKED_HEADER_HEIGHT;
    case "notice":
      return (
        STACKED_HEADER_HEIGHT + STACKED_NOTICE_PADDING + measureHeight(section.text, contentWidth)
      );
    case "raw":
    case "diff": {
      const lines =
        section.kind === "diff" ? stackedPatchLines(section.patch) : section.text.split("\n");
      let body = 0;
      for (const line of lines) body += measureHeight(line, contentWidth);
      return STACKED_HEADER_HEIGHT + body;
    }
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

export function stackedOffsets(
  heights: readonly { readonly path: string; readonly height: number }[],
): readonly StackedOffset[] {
  const offsets: StackedOffset[] = [];
  let top = 0;
  for (const entry of heights) {
    offsets.push({ path: entry.path, top, height: entry.height });
    top += entry.height;
  }
  return offsets;
}

export function stackedScrollHeight(offsets: readonly StackedOffset[]): number {
  const last = offsets.at(-1);
  if (last === undefined) return STACKED_LIST_PADDING_END;
  return last.top + last.height + STACKED_LIST_PADDING_END;
}

export function visibleStackedRange({
  offsets,
  scrollTop,
  viewport,
  overscan = STACKED_OVERSCAN,
}: {
  readonly offsets: readonly StackedOffset[];
  readonly scrollTop: number;
  readonly viewport: number;
  readonly overscan?: number;
}) {
  if (offsets.length === 0) return { start: 0, end: 0 };
  const viewStart = scrollTop - overscan;
  const viewEnd = scrollTop + viewport + overscan;
  let start = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    const entry = offsets[index];
    if (entry === undefined) break;
    if (entry.top + entry.height > viewStart) {
      start = index;
      break;
    }
  }
  let end = offsets.length;
  for (let index = start; index < offsets.length; index += 1) {
    const entry = offsets[index];
    if (entry === undefined) break;
    if (entry.top >= viewEnd) {
      end = index;
      break;
    }
  }
  return { start, end };
}

/** The last file whose section has reached the top of the stacked diff. */
export function activeChangePath({
  offsets,
  scrollTop,
  viewport,
  scrollHeight,
}: {
  readonly offsets: readonly { readonly path: string; readonly top: number }[];
  readonly scrollTop: number;
  readonly viewport: number;
  readonly scrollHeight: number;
}): string | undefined {
  const last = offsets.at(-1);
  if (last === undefined) return undefined;
  if (viewport > 0 && scrollTop + viewport >= scrollHeight - 2) return last.path;
  let current = offsets[0]?.path;
  for (const entry of offsets) {
    if (entry.top <= scrollTop + 1) current = entry.path;
    else break;
  }
  return current;
}

export function uncommittedStackSection({
  path,
  state,
}: {
  readonly path: string;
  readonly state: UncommittedPatch;
}): ChangeStackSection {
  switch (state.kind) {
    case "absent":
      return { kind: "notice", path, text: MISSING_WORKING_TREE };
    case "pending":
      return { kind: "pending", path };
    case "failed":
      return { kind: "notice", path, text: FAILED_PATCH };
    case "empty":
      return { kind: "notice", path, text: EMPTY_PATCH };
    case "ready":
      return { kind: "diff", path, patch: state.patch };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

const RAIL_ROW_PAD = 6;
const RAIL_FILES_PAD = 5;
const RAIL_ICON = 16;
const RAIL_GAP = 5;
const RAIL_PIP = 6;
const RAIL_INDENT = 10;

export function railRowWidth(filesWidth: number): number {
  return Math.max(0, filesWidth - RAIL_FILES_PAD * 2);
}

export function railLabelMaxWidth({
  rowWidth,
  depth,
  statsWidth,
  hasPip,
}: {
  readonly rowWidth: number;
  readonly depth: number;
  readonly statsWidth: number;
  readonly hasPip: boolean;
}): number {
  const indent = depth > 0 ? RAIL_INDENT : 0;
  const pip = hasPip ? RAIL_PIP + RAIL_GAP : 0;
  const stats = statsWidth > 0 ? statsWidth + RAIL_GAP : 0;
  return Math.max(0, rowWidth - RAIL_ROW_PAD * 2 - indent - RAIL_ICON - RAIL_GAP - stats - pip);
}

export function diffMarksWidth({
  added,
  removed,
  measure,
  gap = 3,
}: {
  readonly added: number;
  readonly removed: number;
  readonly measure: (text: string) => number;
  readonly gap?: number;
}): number {
  let width = 0;
  if (added > 0) width += measure(`+${String(added)}`);
  if (removed > 0) {
    if (width > 0) width += gap;
    width += measure(`-${String(removed)}`);
  }
  return width;
}
