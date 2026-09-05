/**
 * Pierre is a leaf renderer here: Nyte supplies the patch, mode, typography,
 * and surrounding geometry. The package's shadow root gets one inherited
 * token bridge because StyleX cannot address that boundary.
 *
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/lib/diff-rendering.ts
 */
import * as stylex from "@stylexjs/stylex";
import type { FileDiffOptions, ThemesType } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { memo } from "react";
import type { ReactElement } from "react";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import { pierrePatchStyles } from "./styles.stylex.ts";

const THEMES = { light: "github-light", dark: "github-dark" } satisfies ThemesType;

// Shadow-DOM contract only. Layout outside the renderer remains in StyleX.
const PIERRE_SHADOW_CSS = `
:host {
  min-width: 0;
  max-width: 100%;
  --diffs-bg: var(--nyte-bg-editor);
  --diffs-bg-buffer: var(--nyte-bg-editor);
  --diffs-bg-context: var(--nyte-bg-editor);
  --diffs-bg-context-gutter: var(--nyte-bg-editor);
  --diffs-bg-separator: var(--nyte-bg-quinary);
  --diffs-fg: var(--nyte-text-primary);
  --diffs-fg-number: var(--nyte-text-tertiary);
  --diffs-addition-base: var(--nyte-added);
  --diffs-deletion-base: var(--nyte-removed);
  --diffs-bg-addition-emphasis: var(--nyte-diff-added-text-background);
  --diffs-bg-deletion-emphasis: var(--nyte-diff-removed-text-background);
  --diffs-gap-style: none;
  --diffs-min-number-column-width: calc(4ch + 8px);
  --diffs-font-family: var(--nyte-font-family-mono);
  --diffs-header-font-family: var(--nyte-font-family-sans);
  --diffs-font-size: var(--nyte-font-size-code);
  --diffs-line-height: var(--nyte-diff-line-height);
  --diffs-tab-size: 4;
}

[data-line-type="change-addition"] {
  --diffs-line-bg: var(--nyte-diff-added-line-background);
}

[data-line-type="change-deletion"] {
  --diffs-line-bg: var(--nyte-diff-removed-line-background);
}

[data-column-number] {
  font-size: max(11px, calc(var(--nyte-font-size-code) - 1px));
}

[data-column-number][data-line-type="change-addition"]::before,
[data-column-number][data-line-type="change-deletion"]::before {
  content: "";
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 3px;
}

[data-column-number][data-line-type="change-addition"]::before {
  background: var(--nyte-added);
}

[data-column-number][data-line-type="change-deletion"]::before {
  background: var(--nyte-removed);
}

* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}

*:hover {
  scrollbar-color: var(--nyte-scrollbar-thumb) transparent;
}

::-webkit-scrollbar {
  width: var(--nyte-scrollbar-lane);
  height: var(--nyte-scrollbar-lane);
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  min-width: 28px;
  min-height: 28px;
  border: 4px solid transparent;
  border-radius: 999px;
  background: transparent;
  background-clip: padding-box;
}

*:hover::-webkit-scrollbar-thumb {
  background-color: var(--nyte-scrollbar-thumb);
}

*:hover::-webkit-scrollbar-thumb:hover {
  background-color: var(--nyte-scrollbar-thumb-hover);
}
`;

const BASE_OPTIONS = {
  theme: THEMES,
  diffStyle: "unified",
  diffIndicators: "classic",
  disableBackground: false,
  disableFileHeader: true,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word",
  overflow: "scroll",
  preferredHighlighter: "shiki-js",
  unsafeCSS: PIERRE_SHADOW_CSS,
} satisfies FileDiffOptions<undefined>;

export const PierrePatch = memo(function PierrePatch({
  patch,
}: {
  readonly patch: string;
}): ReactElement {
  const appearance = useAppearanceSettings();
  const options = {
    ...BASE_OPTIONS,
    themeType: appearance.theme,
  } satisfies FileDiffOptions<undefined>;
  const host = stylex.props(pierrePatchStyles.host);

  return <PatchDiff patch={patch} options={options} className={host.className} disableWorkerPool />;
});
