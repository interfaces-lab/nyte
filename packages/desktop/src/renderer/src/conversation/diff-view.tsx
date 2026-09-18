/**
 * One diff surface shared by transcript receipts and the Changes workbench.
 * Pierre renders the patch inside a shadow root; Nyte's tokens reach it as
 * inherited custom properties on the host, so only rules that must live in
 * the shadow tree go through `unsafeCSS`.
 */
import * as stylex from "@stylexjs/stylex";
import type { FileDiffMetadata, FileDiffOptions, PostRenderPhase } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { memo, useMemo } from "react";
import type { ReactElement } from "react";
import type { ParsedPatch } from "@nyte-ai/client";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { diffStyles } from "./styles.stylex.ts";
import type { DiffFilesLoader } from "./diff-expansion.ts";

type DiffViewVariant = "inline" | "workbench" | "stack";

const SHADOW_CSS = `
/*
 * Context rows and gutter spacers take the plain editor background. This also
 * opts them out of Pierre's hover and selected-line mixes, which the flat
 * surface does not use.
 */
[data-line-type="context"],
[data-gutter-buffer] {
  --diffs-line-bg: var(--diffs-bg);
}

[data-line-type="change-addition"] {
  --diffs-line-bg: var(--nyte-diff-added-line-background);
}

[data-line-type="change-deletion"] {
  --diffs-line-bg: var(--nyte-diff-removed-line-background);
}

[data-column-number][data-line-type="change-addition"]::before,
[data-column-number][data-line-type="change-deletion"]::before {
  content: "";
  contain: strict;
  width: 3px;
  height: 100%;
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  background: var(--diffs-addition-base);
}

[data-column-number][data-line-type="change-deletion"]::before {
  background: var(--diffs-deletion-base);
}

* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

*:hover {
  scrollbar-color: var(--nyte-scrollbar-thumb) transparent;
}

/*
 * Collapsed context between hunks. Pierre emits the row once per grid column
 * and hides the wrapper in the code column, so the count lands in the line
 * number gutter, where it is clipped to a few characters, and the wide column
 * shows a bare tinted band. Cursor puts the count in the code column instead,
 * on a band the width of the code, which is what the row is for.
 */
[data-separator] {
  background-color: transparent;
  /*
   * Two rows: a band the height of one line with room above and below, so the
   * gap reads as a break rather than another line, and the stack's arithmetic
   * still lands on whole rows. A minimum rather than a height, because Pierre
   * pins this row type to 32px and an expanded region has to be able to grow
   * the row past two lines.
   */
  height: auto;
  min-height: calc(var(--nyte-diff-line-height) * 2);
}

/*
 * The count and the expand controls live in the gutter copy and overflow
 * across the band. That copy is the one Pierre pins while the code scrolls,
 * and it carries a z-index of 3, so they stay put, stay on top of the line
 * numbers, and stay reachable at any horizontal scroll offset. The code copy
 * keeps the band but drops its duplicates, so every control exists once.
 */
[data-gutter] [data-separator-wrapper] {
  /* Shared by the band's inset and the buttons drawn over it; an absolutely
   * positioned child resolves its inset against the padding box, so it cannot
   * inherit the padding itself. */
  --nyte-diff-separator-inset: 8px;
  display: flex;
  padding-inline-start: var(--nyte-diff-separator-inset);
  background-color: transparent;
}

[data-gutter] [data-separator-content],
[data-gutter] [data-unmodified-lines] {
  /* Only the text escapes the gutter; the tint must not, or it double-paints
   * over the code copy's band. */
  min-width: 0;
  overflow: visible;
}

[data-content] [data-unmodified-lines],
[data-content] [data-expand-button] {
  display: none;
}

/*
 * Expansion controls. Pierre lays the buttons out as grid columns ahead of the
 * band; in this gutter copy there is no room for them, so they are lifted out
 * of flow and drawn over the leading edge of the band, where Cursor puts them,
 * and the count is indented to clear them.
 */
[data-gutter] [data-expand-button] {
  position: absolute;
  inset-inline-start: var(--nyte-diff-separator-inset);
  inset-block-start: 50%;
  transform: translateY(-50%);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  min-width: 0;
  height: 20px;
  border: 0;
  border-radius: var(--nyte-radius-sm);
  background-color: transparent;
  color: var(--nyte-icon-secondary);
  cursor: pointer;
}

/* Up and down, when one expansion cannot close the gap, sit side by side. */
[data-gutter] [data-expand-button] + [data-expand-button] {
  inset-inline-start: calc(var(--nyte-diff-separator-inset) + 24px);
}

[data-gutter] [data-expand-button]:hover {
  background-color: var(--nyte-bg-quaternary);
  color: var(--nyte-icon-primary);
}

/*
 * Pierre's trailing "Expand all" stays hidden, as it is by default: the pinned
 * gutter copy is a few characters wide, so a trailing text button has nowhere
 * to sit, and repeated clicks on the chevrons reach the same lines.
 */
[data-expand-button][data-expand-all-button] {
  display: none;
}

[data-gutter] [data-separator][data-expand-index] [data-separator-content] {
  padding-inline-start: 24px;
}

[data-gutter] [data-separator-wrapper][data-separator-multi-button] [data-separator-content] {
  padding-inline-start: 48px;
}

[data-content] [data-separator-wrapper] {
  display: flex;
  padding-inline-end: 8px;
  background-color: transparent;
}

[data-separator-content] {
  /* The band runs the full width of the row, as Cursor's does. */
  flex: 1;
  background-color: var(--nyte-bg-tertiary);
  color: var(--nyte-text-tertiary);
  /*
   * Fixed like the row it sits in. The diff's line box is a fixed 20px, so a
   * label that tracked the code font would clip against it at large sizes.
   */
  height: calc(var(--nyte-diff-line-height) + 8px);
  font-size: 12px;
  line-height: calc(var(--nyte-diff-line-height) + 8px);
}

/* The two column copies meet, so only the outer corners round. */
[data-gutter] [data-separator-content] {
  padding-inline: 8px 0;
  border-start-start-radius: var(--nyte-radius-base);
  border-end-start-radius: var(--nyte-radius-base);
}

[data-content] [data-separator-content] {
  padding-inline: 0 8px;
  border-start-end-radius: var(--nyte-radius-base);
  border-end-end-radius: var(--nyte-radius-base);
}
`;

/**
 * Pierre leaves the old `<pre>` in a React-managed shadow root on clean-up.
 * StrictMode detaches and re-attaches the ref on mount, so the replacement
 * instance would find that empty `<pre>`, treat it as prerendered HTML, and
 * never render.
 */
function onPostRender(...[node, , phase]: [HTMLElement, unknown, PostRenderPhase]): void {
  if (phase !== "unmount") return;
  node.shadowRoot?.querySelector("pre")?.remove();
}

const PATCH_OPTIONS = {
  onPostRender,
  theme: { light: "github-light", dark: "github-dark" },
  diffStyle: "unified",
  diffIndicators: "classic",
  disableFileHeader: true,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word",
  overflow: "scroll",
  preferredHighlighter: "shiki-js",
  unsafeCSS: SHADOW_CSS,
} satisfies FileDiffOptions<undefined, undefined>;

/**
 * Lines revealed per click. Short enough that one click reads as a step rather
 * than as the whole file arriving, and it decides the control: a gap this size
 * or smaller closes in one click and gets a single stacked chevron, a longer
 * one gets an up and a down chevron.
 */
const EXPANSION_LINE_COUNT = 20;

const rawStyles = stylex.create({
  raw: {
    margin: 0,
    padding: "8px 12px",
    overflowX: "auto",
    whiteSpace: "pre",
    fontFamily: "var(--nyte-font-family-mono, monospace)",
    fontSize: "12px",
    lineHeight: "18px",
  },
});

type RenderablePatch =
  | { readonly kind: "files"; readonly files: readonly FileDiffMetadata[] }
  | { readonly kind: "raw"; readonly text: string };

/**
 * A patch is external input: one tool result can describe several files, and one
 * file edited twice in a turn arrives as two diffs under the same path. Parse the
 * whole thing and render every entry, because the singular components reject
 * anything but one file and there is no error boundary above this to catch it.
 */
function renderablePatch(patch: string): RenderablePatch {
  try {
    const files = parsePatchFiles(patch).flatMap((parsed) => parsed.files);
    return files.length > 0 ? { kind: "files", files } : { kind: "raw", text: patch };
  } catch {
    return { kind: "raw", text: patch };
  }
}

/** The bytes a diff draws and the counts beside them; the counts are the record's, not a reparse. */
export type DiffFacts = Pick<ParsedPatch, "patch" | "added" | "removed">;

export const DiffView = memo(function DiffView({
  path,
  label,
  diff,
  variant,
  layout = "unified",
  wordWrap,
  expandContext = true,
  loadDiffFiles,
}: {
  readonly path: string;
  readonly label?: string;
  readonly diff: DiffFacts;
  readonly variant: DiffViewVariant;
  readonly layout?: "unified" | "split";
  /** Defaults to the variant's own behavior: the stack wraps, the rest scroll. */
  readonly wordWrap?: boolean;
  readonly expandContext?: boolean;
  /**
   * Supplies both whole sides of a file so a collapsed gap can be widened.
   * Without it Pierre draws no expand control, which is what a transcript
   * receipt wants: its patch is the record, and the working tree has moved on.
   * Keep the identity stable across renders, or every render reloads.
   */
  readonly loadDiffFiles?: DiffFilesLoader;
}): ReactElement {
  const headed = variant === "workbench";
  const stacked = variant === "stack";
  const appearance = useAppearanceSettings();
  const renderable = useMemo(() => renderablePatch(diff.patch), [diff.patch]);
  const wrapped = wordWrap ?? stacked;
  const expansion = expandContext ? loadDiffFiles : undefined;
  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({
      ...PATCH_OPTIONS,
      diffStyle: layout,
      overflow: wrapped ? "wrap" : "scroll",
      themeType: appearance.theme,
      // `expandUnchanged` stays off: it would open every gap at once, and the
      // point of the band is that the reader chooses.
      loadDiffFiles: expansion,
      expansionLineCount: EXPANSION_LINE_COUNT,
    }),
    [layout, wrapped, appearance.theme, expansion],
  );

  return (
    <div
      {...stylex.props(
        stacked ? diffStyles.stack : diffStyles.surface,
        stacked ? undefined : headed ? diffStyles.workbench : diffStyles.inline,
      )}
    >
      {headed && (
        <div {...stylex.props(diffStyles.header)}>
          <span title={path} {...stylex.props(diffStyles.path)}>
            {label ?? path}
          </span>
          <span
            aria-label={`${String(diff.added)} added, ${String(diff.removed)} removed`}
            {...stylex.props(diffStyles.stats)}
          >
            {diff.added > 0 && <span {...stylex.props(diffStyles.added)}>+{diff.added}</span>}
            {diff.removed > 0 && <span {...stylex.props(diffStyles.removed)}>-{diff.removed}</span>}
          </span>
        </div>
      )}
      <div
        {...(!stacked ? { "data-nyte-scrollport": "balanced" } : {})}
        {...stylex.props(
          diffStyles.body,
          stacked
            ? diffStyles.bodyStack
            : headed
              ? diffStyles.bodyWorkbench
              : diffStyles.bodyInline,
        )}
      >
        {renderable.kind === "raw" ? (
          <pre {...stylex.props(rawStyles.raw)}>{renderable.text}</pre>
        ) : (
          // A path can repeat within one patch, so it cannot key these on its own.
          renderable.files.map((fileDiff, index) => (
            <FileDiff
              key={`${String(index)}:${fileDiff.name ?? path}`}
              fileDiff={fileDiff}
              options={options}
              className={stylex.props(diffStyles.patch).className}
              disableWorkerPool
            />
          ))
        )}
      </div>
    </div>
  );
});
