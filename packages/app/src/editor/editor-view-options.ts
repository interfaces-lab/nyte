import { DEFAULT_CODE_VIEW_LAYOUT } from "@nyte-ai/ui/diffs";
import type { PostRenderPhase } from "@nyte-ai/ui/diffs";
import { button, glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { appearance, motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
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
${DECLARATION_LINK_CSS}
`;

const EDITOR_WIDGET_CSS = `
@keyframes nyte-marker-popover-in {
  from {
    opacity: 0;
    transform: translateY(-2px) scale(0.985);
  }
}
[data-editor-widget] {
  z-index: 10;
  border: 0;
  border-radius: ${radius.control};
  background-color: ${role.popupMaterial};
  backdrop-filter: ${appearance.popupMaterialFilter};
  box-shadow: ${shadow.shadowLg}, inset 0 0 0 1px ${role.strokeQuaternary};
  color: ${role.contentPrimary};
  font-family: ${type.fontSans};
  font-size: ${type.fontSm};
  line-height: ${type.leadingSm};
  letter-spacing: ${type.letterBase};
}
@media (forced-colors: active) {
  [data-editor-widget] {
    border: 1px solid CanvasText;
  }
}
[data-marker-popover] {
  min-width: 0;
  max-width: min(460px, var(--popover-available-width));
  margin-block: ${space.s1};
  padding: 0;
  border-radius: ${radius.card};
  background-color: ${role.popupMaterial};
  box-shadow: ${shadow.shadowLg}, inset 0 0 0 1px ${role.strokeQuaternary};
  color: ${role.contentPrimary};
  animation-name: nyte-marker-popover-in;
  animation-duration: ${motion.durationFast};
  animation-timing-function: ${motion.easeOutQuint};
}
@media (prefers-reduced-motion: reduce) {
  [data-marker-popover] {
    animation-name: none;
  }
}
[data-marker-popover]::before {
  content: "";
  position: absolute;
  inset: calc(${space.s1} * -1) 0;
  z-index: -1;
}
[data-marker-popover][data-marker-error] {
  --_diagnostic-accent: var(--nyte-diagnostic-error, var(--diffs-marker-bg));
}
[data-marker-popover][data-marker-warning] {
  --_diagnostic-accent: var(--nyte-diagnostic-warning, var(--diffs-marker-bg));
}
[data-marker-popover][data-marker-info] {
  --_diagnostic-accent: var(--nyte-diagnostic-info, var(--diffs-marker-bg));
}
[data-marker-popover][data-marker-hint] {
  --_diagnostic-accent: ${role.contentTertiary};
}
[data-diagnostic] {
  display: flex;
  flex-direction: column;
}
[data-diagnostic-body] {
  display: flex;
  align-items: flex-start;
  gap: ${space.s2};
  padding-block: ${space.s2};
  padding-inline: ${space.s3};
}
[data-diagnostic-icon] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: ${glyph.sm};
  height: ${type.leadingBase};
  color: var(--_diagnostic-accent, ${role.contentSecondary});
}
[data-diagnostic-icon] svg {
  display: block;
  width: ${glyph.sm};
  height: ${glyph.sm};
}
[data-diagnostic-text] {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: ${role.contentPrimary};
  font-size: ${type.fontBase};
  line-height: ${type.leadingBase};
  white-space: pre-wrap;
  text-wrap: pretty;
  overflow-wrap: anywhere;
}
[data-diagnostic-footer] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.s3};
  padding-block: ${space.s1};
  padding-inline-start: ${space.s3};
  padding-inline-end: ${space.s1_5};
  box-shadow: inset 0 1px 0 ${role.strokeQuaternary};
}
[data-diagnostic-footer][data-diagnostic-action-only] {
  padding-inline-start: ${space.s1_5};
}
[data-diagnostic-meta] {
  display: flex;
  align-items: baseline;
  gap: ${space.s1};
  min-width: 0;
  overflow: hidden;
  color: ${role.contentTertiary};
  font-size: ${type.fontXs};
  line-height: ${type.leadingXs};
}
[data-diagnostic-source] {
  flex-shrink: 0;
}
[data-diagnostic-code] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ${type.fontMono};
}
[data-diagnostic-action] {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: ${space.s1_5};
  flex-shrink: 0;
  margin: 0;
  padding-block: ${space.s0_5};
  padding-inline: ${space.s1_5};
  border: 0;
  border-radius: ${button.radiusSm};
  background-color: transparent;
  color: ${role.contentSecondary};
  font-family: ${type.fontSans};
  font-size: ${type.fontXs};
  line-height: ${type.leadingXs};
  cursor: ${appearance.cursorInteractive};
  user-select: none;
  transition-property: background-color, color;
  transition-duration: ${motion.durationFast};
  transition-timing-function: ${motion.easeOut};
}
@media (hover: hover) and (pointer: fine) {
  [data-diagnostic-action]:hover {
    background-color: ${role.fillTertiary};
    color: ${role.contentPrimary};
  }
}
[data-diagnostic-action]:active {
  background-color: ${role.fillSecondary};
}
[data-diagnostic-action]:focus-visible {
  outline: 1px solid ${appearance.focusRing};
  outline-offset: -1px;
}
[data-diagnostic-action] kbd {
  color: ${role.contentTertiary};
  font-family: ${type.fontSans};
  font-size: inherit;
  line-height: inherit;
}
${SELECTION_ACTION_CSS}
`;

let widgetSheet: CSSStyleSheet | undefined;

/** Adopted into the editor shadow root so unlayered rules beat Pierre's unlayered widget defaults. */
export function editorWidgetSheet(): CSSStyleSheet {
  if (widgetSheet === undefined) {
    widgetSheet = new CSSStyleSheet();
    widgetSheet.replaceSync(EDITOR_WIDGET_CSS);
  }

  return widgetSheet;
}

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
