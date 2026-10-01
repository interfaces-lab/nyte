import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { button, shape } from "@nyte-ai/ui/schema.stylex";
/**
 * One diff surface shared by transcript receipts and the Changes workbench.
 * Pierre renders the patch inside a shadow root; Nyte's tokens reach it as
 * inherited custom properties on the host, so only rules that must live in
 * the shadow tree go through `unsafeCSS`.
 */
import { create, props } from "@stylexjs/stylex";
import type { FileDiffMetadata, FileDiffOptions, PostRenderPhase } from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { memo, useMemo } from "react";
import type { ReactElement } from "react";
import type { ParsedPatch } from "@nyte-ai/client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  PIERRE_THEME,
  PIERRE_TOKEN_CSS,
  PierreWorkerProvider,
} from "../pierre-worker-provider.tsx";
import { diffView } from "../theme/schema.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { appearance, role, type } from "@nyte-ai/ui/vars.stylex";
import { patchDigest } from "../workbench/changes-viewed.ts";
import { diffStyles } from "./styles.stylex.ts";
import type { DiffFilesLoader } from "./diff-expansion.ts";

type DiffViewVariant = "inline" | "workbench" | "stack";

const SHADOW_CSS = `
${PIERRE_TOKEN_CSS}
:host {
  color-scheme: inherit;
}
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
  --diffs-line-bg: var(--diffs-bg-addition);
}

[data-line-type="change-deletion"] {
  --diffs-line-bg: var(--diffs-bg-deletion);
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
  scrollbar-color: ${role.scrollbarThumb} transparent;
}

[data-separator] {
  background-color: transparent;
  height: auto;
  min-height: max(calc(${diffView.lineHeight} * 2), calc(${button.heightSm} + 8px));
}

[data-gutter] [data-separator-wrapper] {
  display: flex;
  gap: 8px;
  width: max-content;
  padding-inline: 8px;
  background-color: transparent;
}

[data-content] [data-separator-wrapper] {
  display: none;
}

[data-gutter] [data-expand-button] {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: ${button.heightSm};
  min-width: 24px;
  height: ${button.heightSm};
  min-height: 24px;
  padding: 0;
  border: 0;
  border-radius: ${shape.indicator};
  background-color: transparent;
  color: ${role.contentInteractiveSecondary};
  cursor: ${appearance.cursorInteractive};
}

[data-gutter] [data-expand-button]:hover {
  background-color: ${role.bgHover};
  color: ${role.contentInteractivePrimary};
}

[data-gutter] [data-expand-button]:focus-visible {
  outline: 2px solid ${role.borderInteractivePrimary};
  outline-offset: 2px;
}

[data-gutter] [data-expand-button][data-unmodified-lines] {
  width: auto;
  padding-inline: 8px;
  background-color: ${role.bgMutedTranslucent};
  color: ${role.contentSecondary};
  font-size: 12px;
}

[data-gutter] [data-expand-all-button]:not([data-unmodified-lines]):not([data-expand-both]) {
  display: none;
}

[data-gutter] [data-separator-content] {
  min-width: 0;
  padding: 0;
  background-color: transparent;
  overflow: visible;
}

@media (pointer: coarse) {
  [data-separator] {
    min-height: 52px;
  }

  [data-gutter] [data-expand-button] {
    min-width: 44px;
    min-height: 44px;
  }
}

`;

/**
 * Pierre leaves the old `<pre>` in a React-managed shadow root on clean-up.
 * StrictMode detaches and re-attaches the ref on mount, so the replacement
 * instance would find that empty `<pre>`, treat it as prerendered HTML, and
 * never render.
 */
function applyDiffScopes(node: HTMLElement): void {
  const sample = document.createElement("span");
  sample.hidden = true;
  node.after(sample);

  // Scope classes live outside the shadow tree. Copy computed custom properties,
  // keeping light-dark() intact so system appearance changes still resolve.
  for (const entry of [
    {
      scope: surfaceTheme.green,
      properties: [
        ["--diffs-bg-addition-override", role.bgInteractiveSecondaryTranslucent],
        ["--diffs-bg-addition-emphasis-override", role.bgInteractivePrimaryTranslucent],
        ["--diffs-addition-color-override", role.contentSecondary],
      ],
    },
    {
      scope: surfaceTheme.red,
      properties: [
        ["--diffs-bg-deletion-override", role.bgInteractiveSecondaryTranslucent],
        ["--diffs-bg-deletion-emphasis-override", role.bgInteractivePrimaryTranslucent],
        ["--diffs-deletion-color-override", role.contentSecondary],
      ],
    },
    {
      scope: surfaceTheme.blue,
      properties: [["--diffs-modified-color-override", role.contentSecondary]],
    },
  ] as const) {
    sample.className = props(entry.scope).className ?? "";
    const computed = getComputedStyle(sample);

    for (const [property, handle] of entry.properties) {
      node.style.setProperty(property, computed.getPropertyValue(handle.slice(4, -1)));
    }
  }

  sample.remove();
}

function adaptDiffExpanders(node: HTMLElement): void {
  const root = node.shadowRoot;

  if (root === null) return;

  for (const control of root.querySelectorAll(
    "[data-expand-index] [data-expand-button], [data-expand-index] [data-unmodified-lines]",
  )) {
    if (control instanceof HTMLButtonElement) continue;
    const button = document.createElement("button");
    button.type = "button";

    for (const attribute of control.attributes) {
      if (attribute.name !== "role") button.setAttribute(attribute.name, attribute.value);
    }

    const entireRegion =
      control.hasAttribute("data-unmodified-lines") ||
      control.hasAttribute("data-expand-both") ||
      control.hasAttribute("data-expand-all-button");

    if (entireRegion) {
      button.setAttribute("data-expand-button", "");
      button.setAttribute("data-expand-all-button", "");
    }

    button.setAttribute(
      "aria-label",
      entireRegion
        ? "Expand the entire hidden region"
        : `Show ${String(EXPANSION_LINE_COUNT)} more lines ${control.hasAttribute("data-expand-up") ? "above" : "below"}`,
    );
    button.append(...control.childNodes);
    control.replaceWith(button);
  }
}

function onPostRender(...[node, , phase]: [HTMLElement, unknown, PostRenderPhase]): void {
  if (phase === "unmount") {
    node.shadowRoot?.querySelector("pre")?.remove();
    return;
  }

  applyDiffScopes(node);
  adaptDiffExpanders(node);
}

const PATCH_OPTIONS = {
  onPostRender,
  theme: PIERRE_THEME,
  diffIndicators: "classic",
  disableFileHeader: true,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word",
  unsafeCSS: SHADOW_CSS,
} satisfies FileDiffOptions<undefined, undefined>;

/**
 * Lines revealed per click. Short enough that one click reads as a step rather
 * than as the whole file arriving, and it decides the control: a gap this size
 * or smaller closes in one click and gets a single stacked chevron, a longer
 * one gets an up and a down chevron.
 */
const EXPANSION_LINE_COUNT = 20;

const rawStyles = create({
  raw: {
    margin: 0,
    padding: "8px 12px",
    overflowX: "auto",
    whiteSpace: "pre",
    fontFamily: type.fontMono,
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
    const files = parsePatchFiles(patch, patchDigest(patch)).flatMap((parsed) => parsed.files);

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
      {...props(
        stacked ? diffStyles.stack : diffStyles.surface,
        stacked ? undefined : headed ? diffStyles.workbench : diffStyles.inline,
      )}
    >
      {headed && (
        <div {...props(diffStyles.header)}>
          <Tooltip>
            <TooltipTrigger render={<span {...props(diffStyles.path)}>{label ?? path}</span>} />
            <TooltipContent>{path}</TooltipContent>
          </Tooltip>
          <span
            aria-label={`${String(diff.added)} added, ${String(diff.removed)} removed`}
            {...props(diffStyles.stats)}
          >
            {diff.added > 0 && (
              <span {...props(intent.success, diffStyles.added)}>+{diff.added}</span>
            )}
            {diff.removed > 0 && (
              <span {...props(intent.danger, diffStyles.removed)}>-{diff.removed}</span>
            )}
          </span>
        </div>
      )}
      <div
        {...(!stacked ? { "data-nyte-scrollport": "balanced" } : {})}
        {...props(
          diffStyles.body,
          stacked
            ? diffStyles.bodyStack
            : headed
              ? diffStyles.bodyWorkbench
              : diffStyles.bodyInline,
        )}
      >
        {renderable.kind === "raw" ? (
          <pre {...props(rawStyles.raw)}>{renderable.text}</pre>
        ) : (
          <PierreWorkerProvider>
            {/* A path can repeat within one patch, so it cannot key these on its own. */}
            {renderable.files.map((fileDiff, index) => (
              <FileDiff
                key={`${String(index)}:${fileDiff.name ?? path}`}
                fileDiff={fileDiff}
                options={options}
                className={props(diffStyles.patch).className}
              />
            ))}
          </PierreWorkerProvider>
        )}
      </div>
    </div>
  );
});
