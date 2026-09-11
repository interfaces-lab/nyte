/**
 * One diff surface shared by transcript receipts and the Changes workbench.
 * Pierre renders the patch inside a shadow root; Nyte's tokens reach it as
 * inherited custom properties on the host, so only rules that must live in
 * the shadow tree go through `unsafeCSS`.
 */
import * as stylex from "@stylexjs/stylex";
import type { FileDiffOptions, PostRenderPhase } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { memo } from "react";
import type { ReactElement } from "react";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { diffStyles } from "./styles.stylex.ts";
import type { ParsedDiff } from "./tool-detail.ts";

export type DiffViewVariant = "inline" | "workbench" | "stack";

const SHADOW_CSS = `
[data-line-type="context"],
[data-separator],
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

const PATCH_STACK = { ...PATCH_OPTIONS, overflow: "wrap" } satisfies FileDiffOptions<
  undefined,
  undefined
>;

export const DiffView = memo(function DiffView({
  path,
  label,
  diff,
  variant,
}: {
  readonly path: string;
  readonly label?: string;
  readonly diff: ParsedDiff;
  readonly variant: DiffViewVariant;
}): ReactElement {
  const headed = variant === "workbench";
  const stacked = variant === "stack";
  const appearance = useAppearanceSettings();

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
        <PatchDiff
          patch={diff.patch}
          options={{
            ...(stacked ? PATCH_STACK : PATCH_OPTIONS),
            themeType: appearance.theme,
          }}
          className={stylex.props(diffStyles.patch).className}
          disableWorkerPool
        />
      </div>
    </div>
  );
});
