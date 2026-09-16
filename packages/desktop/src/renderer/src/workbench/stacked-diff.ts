/**
 * Stacked Changes geometry. Heights come from Pretext (or an injected
 * measure) so jump-to-file and scroll-spy never read offsetTop.
 */
import { parsePatch } from "diff";

/** 36px header + 1px rule, 52px after the last file. */
export const STACKED_HEADER_HEIGHT = 37;
export const STACKED_LIST_PADDING_END = 52;
/** Must equal `--nyte-diff-line-height`, the line box Pierre lays the diff on. */
export const STACKED_DIFF_LINE_HEIGHT = 20;
export const STACKED_NOTICE_PADDING = 20;
const STACKED_OVERSCAN = 800;

/**
 * Everything Pierre puts between the pane edge and the text of a line: the
 * number column's own padding plus the line's. Ten characters wide while line
 * numbers fit the column's four-digit minimum, and one more per digit past it.
 */
const STACKED_TEXT_INSET_CHARS = 10;
const STACKED_NUMBER_COLUMN_PAD = 8;
const STACKED_NUMBER_COLUMN_DIGITS = 4;

/**
 * Stands in for a collapsed-context row. Short enough never to wrap, so each
 * measures as one of the rows the band spans.
 */
const COLLAPSED_CONTEXT_ROW = "";
/** Rows the band occupies: its own line, plus the space above and below it. */
const COLLAPSED_CONTEXT_ROWS = 2;

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
  /** Height the stack places the next section from: measured when we have one. */
  readonly height: number;
  /** Height the section reserves for itself. Never derived from a measurement. */
  readonly estimate: number;
}

/** Git headers and hunk ranges are parsed away rather than drawn. */
function isRenderedPatchLine(line: string): boolean {
  return !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("@@");
}

/**
 * The rows Pierre will draw, as strings the caller measures for wrapping.
 *
 * A collapsed-context row stands for a gap in the file, so it is emitted per
 * gap rather than per hunk: a patch whose first hunk opens at line 1 has one
 * fewer of them than it has hunks. Counting hunks instead left every such
 * section short by a row.
 */
export function stackedPatchLines(patch: string): readonly string[] {
  let files;
  try {
    files = parsePatch(patch);
  } catch {
    // jsdiff rejects malformed counts that Pierre still renders.
    return patch.split("\n").filter(isRenderedPatchLine);
  }
  if (files.length === 0) {
    return patch.split("\n").filter(isRenderedPatchLine);
  }
  const lines: string[] = [];
  for (const file of files) {
    let covered = 1;
    for (const hunk of file.hunks) {
      if (hunk.oldStart > covered) {
        for (let row = 0; row < COLLAPSED_CONTEXT_ROWS; row += 1) {
          lines.push(COLLAPSED_CONTEXT_ROW);
        }
      }
      covered = hunk.oldStart + hunk.oldLines;
      for (const raw of hunk.lines) {
        lines.push(raw.length > 0 ? raw.slice(1) : "");
      }
    }
  }
  return lines;
}

/**
 * Width the text of a line actually gets. Measuring against the pane instead
 * under-counts wrapped rows, and an under-counted section overflows the slot
 * every offset below it was placed from.
 */
export function stackedGutterWidth(characterWidth: number, digits = 4): number {
  const overflowDigits = Math.max(0, digits - STACKED_NUMBER_COLUMN_DIGITS);
  return (STACKED_TEXT_INSET_CHARS + overflowDigits) * characterWidth + STACKED_NUMBER_COLUMN_PAD;
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
  heights: readonly {
    readonly path: string;
    readonly height: number;
    readonly estimate?: number;
  }[],
): readonly StackedOffset[] {
  const offsets: StackedOffset[] = [];
  let top = 0;
  for (const entry of heights) {
    offsets.push({
      path: entry.path,
      top,
      height: entry.height,
      estimate: entry.estimate ?? entry.height,
    });
    top += entry.height;
  }
  return offsets;
}

/**
 * Identity a measured height is filed under. The digest covers the section's
 * own text, so a refetched patch reads as a different section rather than
 * inheriting the height the previous patch happened to have.
 */
export interface StackedSectionIdentity {
  readonly path: string;
  readonly digest: string;
  readonly collapsed: boolean;
}

/** FNV-1a over the section's text. Length is mixed in to separate prefixes. */
export function stackedSectionDigest(section: ChangeStackSection): string {
  const text =
    section.kind === "diff" ? section.patch : section.kind === "pending" ? "" : section.text;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${section.kind}:${String(text.length)}:${(hash >>> 0).toString(36)}`;
}

export function stackedMeasurementKey(identity: StackedSectionIdentity): string {
  return `${identity.path}\u0000${identity.digest}\u0000${identity.collapsed ? "c" : "e"}`;
}

interface StackedMeasurement {
  readonly path: string;
  readonly digest: string;
  readonly height: number;
}

export interface StackedMeasurements {
  readonly size: number;
  /** The measured height for this exact section text, if one was recorded. */
  height: (identity: StackedSectionIdentity) => number | undefined;
  /** Records a mounted section's height. Returns whether geometry changed. */
  record: (measurement: StackedSectionIdentity & { readonly height: number }) => boolean;
  /** Immutable view keyed by `stackedMeasurementKey`, for rendering from. */
  snapshot: () => ReadonlyMap<string, number>;
}

/** Sections outlive their mounted DOM, so the cache is bounded rather than tied to it. */
const STACKED_MEASUREMENT_LIMIT = 240;

/**
 * Heights of sections that have mounted, keyed by section identity and evicted
 * least-recently-used. Unmounting a virtualized section keeps its height; a
 * section whose text changed drops the height recorded for the old text.
 */
export function createStackedMeasurements(limit = STACKED_MEASUREMENT_LIMIT): StackedMeasurements {
  const entries = new Map<string, StackedMeasurement>();

  const touch = (key: string, measurement: StackedMeasurement): void => {
    entries.delete(key);
    entries.set(key, measurement);
  };

  return {
    get size() {
      return entries.size;
    },
    height: (identity) => {
      const key = stackedMeasurementKey(identity);
      const found = entries.get(key);
      if (found === undefined) return undefined;
      touch(key, found);
      return found.height;
    },
    record: ({ path, digest, collapsed, height }) => {
      // Subpixel layout noise would otherwise reflow the stack on every frame.
      const rounded = Math.round(height);
      for (const [key, measurement] of entries) {
        if (measurement.path === path && measurement.digest !== digest) entries.delete(key);
      }
      const key = stackedMeasurementKey({ path, digest, collapsed });
      const previous = entries.get(key);
      touch(key, { path, digest, height: rounded });
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
      return previous?.height !== rounded;
    },
    snapshot: () => new Map(Array.from(entries, ([key, measurement]) => [key, measurement.height])),
  };
}

/**
 * Scroll position that keeps the reader's place after sections change height.
 *
 * A section that ended above the viewport moves everything below it by its
 * delta, so the scroll offset follows it. A section the reader is looking at
 * keeps its top edge where it is, which means leaving scrollTop alone.
 */
export function stackedScrollAfterResize({
  previous,
  next,
  scrollTop,
}: {
  readonly previous: readonly StackedOffset[];
  readonly next: readonly StackedOffset[];
  readonly scrollTop: number;
}): number {
  const heights = new Map(next.map((offset) => [offset.path, offset.height]));
  let shift = 0;
  for (const offset of previous) {
    if (offset.top + offset.height > scrollTop) break;
    const height = heights.get(offset.path);
    if (height === undefined) continue;
    shift += height - offset.height;
  }
  return Math.max(0, scrollTop + shift);
}

/** The part of a `ResizeObserverEntry` the stack reads. */
export interface StackedResizeEntry<Target> {
  readonly target: Target;
  readonly borderBoxSize?: readonly { readonly blockSize: number }[];
  readonly contentRect: { readonly height: number };
}

export interface StackedResizeObserver<Target> {
  observe: (target: Target) => void;
  unobserve: (target: Target) => void;
  disconnect: () => void;
}

export interface StackedMeasurer<Target> {
  /**
   * Ref callback for a section's outer element. Stable per identity, so a
   * re-render neither re-observes the node nor re-reports its height.
   */
  attach: (identity: StackedSectionIdentity) => (node: Target | null) => (() => void) | undefined;
  disconnect: () => void;
}

/**
 * Watches mounted sections and files their heights under their identity. The
 * observer is created on first attach so a server render never touches it.
 */
export function createStackedMeasurer<Target extends object>({
  measurements,
  createObserver,
  onMeasured,
}: {
  readonly measurements: StackedMeasurements;
  readonly createObserver: (
    callback: (entries: readonly StackedResizeEntry<Target>[]) => void,
  ) => StackedResizeObserver<Target>;
  readonly onMeasured: () => void;
}): StackedMeasurer<Target> {
  const observed = new Map<Target, StackedSectionIdentity>();
  const refs = new Map<string, (node: Target | null) => (() => void) | undefined>();
  let observer: StackedResizeObserver<Target> | undefined;

  const handle = (entries: readonly StackedResizeEntry<Target>[]): void => {
    let changed = false;
    for (const entry of entries) {
      const identity = observed.get(entry.target);
      if (identity === undefined) continue;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (measurements.record({ ...identity, height })) changed = true;
    }
    if (changed) onMeasured();
  };

  return {
    attach: (identity) => {
      const key = stackedMeasurementKey(identity);
      const cached = refs.get(key);
      if (cached !== undefined) return cached;
      for (const other of refs.keys()) {
        if (other !== key && other.startsWith(`${identity.path}\u0000`)) refs.delete(other);
      }
      const ref = (node: Target | null): (() => void) | undefined => {
        if (node === null) return undefined;
        observer ??= createObserver(handle);
        observed.set(node, identity);
        observer.observe(node);
        return () => {
          observed.delete(node);
          observer?.unobserve(node);
        };
      };
      refs.set(key, ref);
      return ref;
    },
    disconnect: () => {
      observed.clear();
      refs.clear();
      observer?.disconnect();
      observer = undefined;
    },
  };
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
