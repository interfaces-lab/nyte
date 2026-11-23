import { DEFAULT_CODE_VIEW_LAYOUT } from "@nyte-ai/ui/diffs";
import type { PostRenderPhase } from "@nyte-ai/ui/diffs";
import { appearance, role } from "@nyte-ai/ui/styles/vars.stylex";
import { PIERRE_EDITOR_HIGHLIGHTER_OPTIONS, PIERRE_TOKEN_CSS } from "@nyte-ai/ui/worker-pool";
import type { ThemePreference } from "../contract/bridge.ts";
import { applyDiffScopes } from "../diff/diff-view.tsx";
import { SELECTION_ACTION_CSS } from "./editor-selection.ts";
import { DECLARATION_LINK_CSS } from "./use-declarations.ts";

const EDITOR_CSS = `
${PIERRE_TOKEN_CSS}
:host {
  color-scheme: inherit;
  --diffs-bg: transparent;
}
[data-editor-widget]:not([data-marker-popover]) {
  --diffs-widget-bg: ${role.popupMaterial};
  --diffs-widget-border: ${role.strokeTertiary};
  backdrop-filter: ${appearance.popupMaterialFilter};
}
${SELECTION_ACTION_CSS}
${DECLARATION_LINK_CSS}
`;

const EDITOR_LAYOUT = { ...DEFAULT_CODE_VIEW_LAYOUT, paddingTop: 0 };

const metricsBySize = new Map<number, { readonly lineHeight: number }>();

function codeViewMetrics(codeFontSize: number) {
  const held = metricsBySize.get(codeFontSize);

  if (held !== undefined) return held;
  const made = { lineHeight: Math.ceil((codeFontSize * 20) / 12) };
  metricsBySize.set(codeFontSize, made);

  return made;
}

export function editorViewOptions(input: {
  readonly theme: ThemePreference;
  readonly lineNumbers: boolean;
  readonly wordWrap: boolean;
  readonly codeFontSize: number;
}) {
  return {
    ...PIERRE_EDITOR_HIGHLIGHTER_OPTIONS,
    themeType: input.theme,
    unsafeCSS: EDITOR_CSS,
    disableFileHeader: true,
    layout: EDITOR_LAYOUT,
    itemMetrics: codeViewMetrics(input.codeFontSize),
    disableLineNumbers: !input.lineNumbers,
    overflow: input.wordWrap ? ("wrap" as const) : ("scroll" as const),
    onPostRender: colorChanges,
    searchOptions: { disableShortcuts: true },
    pointerEventsOnScroll: true,
  };
}

function colorChanges(...[node, , phase]: [HTMLElement, unknown, PostRenderPhase]): void {
  if (phase !== "unmount") applyDiffScopes(node);
}
