import type { SessionId } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { sessionId } from "../../../shared/schemas.ts";

/**
 * A pane's identity, not its position: drafts, mounted components, and the
 * focus request follow a pane across reorders, and the survivor of a close
 * keeps its identity, so a single layout can legitimately be "secondary".
 */
export type PaneId = "primary" | "secondary";
export type SplitDirection = "right" | "down";
export type DropPlacement = "center" | "top" | "bottom" | "left" | "right";
type EdgeDropPlacement = Exclude<DropPlacement, "center">;

export type PaneSelection =
  | { readonly kind: "blank" }
  | { readonly kind: "session"; readonly sessionId: SessionId };

/** A derived pairing for iteration; the layout stores selections directly. */
export interface PaneState {
  readonly id: PaneId;
  readonly selection: PaneSelection;
}

type SplitLayout = {
  readonly kind: "split";
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly leading: PaneId;
  readonly primary: PaneSelection;
  readonly secondary: PaneSelection;
  readonly activePaneId: PaneId;
};

export type PaneLayout =
  | { readonly kind: "single"; readonly paneId: PaneId; readonly selection: PaneSelection }
  | SplitLayout;

export type PaneLayoutAction =
  | { readonly kind: "select"; readonly selection: PaneSelection }
  | { readonly kind: "select-in-pane"; readonly paneId: PaneId; readonly selection: PaneSelection }
  | { readonly kind: "split"; readonly direction: SplitDirection }
  | { readonly kind: "close"; readonly paneId: PaneId }
  | { readonly kind: "focus"; readonly paneId: PaneId }
  | { readonly kind: "resize"; readonly ratio: number }
  | {
      readonly kind: "drop-session";
      readonly sessionId: SessionId;
      readonly targetPaneId: PaneId;
      readonly placement: DropPlacement;
    }
  | { readonly kind: "remove-session"; readonly sessionId: SessionId };

export const BLANK_SELECTION: PaneSelection = { kind: "blank" };
export const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;
/**
 * A ratio alone lets the composer, the model chip, and the header actions
 * collide on a narrow window. Below this the pane clips, so the sash stops.
 */
const MIN_PANE_WIDTH = 320;

/** Both split commands use the same window-width floor as their menu availability. */
export function canSplitPane(layout: PaneLayout, windowWidth: number): boolean {
  return layout.kind === "single" && windowWidth >= 2 * MIN_PANE_WIDTH;
}

export function createSinglePane(
  paneId: PaneId = "primary",
  selection: PaneSelection = BLANK_SELECTION,
): PaneLayout {
  return { kind: "single", paneId, selection };
}

export function paneSelection(layout: PaneLayout, paneId: PaneId): PaneSelection | undefined {
  if (layout.kind === "single") return layout.paneId === paneId ? layout.selection : undefined;
  return paneId === "primary" ? layout.primary : layout.secondary;
}

export function activePane(layout: PaneLayout): PaneState {
  if (layout.kind === "single") return { id: layout.paneId, selection: layout.selection };
  const id = layout.activePaneId;
  return { id, selection: id === "primary" ? layout.primary : layout.secondary };
}

export function orderedPanes(layout: PaneLayout): readonly PaneState[] {
  if (layout.kind === "single") return [{ id: layout.paneId, selection: layout.selection }];
  const panes: readonly PaneState[] = [
    { id: "primary", selection: layout.primary },
    { id: "secondary", selection: layout.secondary },
  ];
  return layout.leading === "primary" ? panes : panes.toReversed();
}

export function visibleSessionIds(layout: PaneLayout): ReadonlySet<SessionId> {
  const sessionIds = new Set<SessionId>();
  for (const pane of orderedPanes(layout)) {
    if (pane.selection.kind === "session") sessionIds.add(pane.selection.sessionId);
  }
  return sessionIds;
}

export function paneForSession(layout: PaneLayout, sessionId: SessionId): PaneId | undefined {
  return orderedPanes(layout).find(
    (pane) => pane.selection.kind === "session" && pane.selection.sessionId === sessionId,
  )?.id;
}

export function activeSelection(layout: PaneLayout): PaneSelection {
  return activePane(layout).selection;
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

/**
 * The ratio clamp plus a pixel floor, measured against the split container.
 * A container too narrow to hold two full panes keeps the ratio clamp alone.
 */
export function clampSplitRatioForSize(ratio: number, size: number): number {
  const clamped = clampSplitRatio(ratio);
  if (!Number.isFinite(size) || size < 2 * MIN_PANE_WIDTH) return clamped;
  const floor = MIN_PANE_WIDTH / size;
  return Math.min(1 - floor, Math.max(floor, clamped));
}

function otherPaneId(paneId: PaneId): PaneId {
  return paneId === "primary" ? "secondary" : "primary";
}

function sameSelection(left: PaneSelection, right: PaneSelection): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "blank" || right.kind === "blank") return true;
  return left.sessionId === right.sessionId;
}

function withPaneSelection(
  layout: SplitLayout,
  paneId: PaneId,
  selection: PaneSelection,
): SplitLayout {
  const current = paneId === "primary" ? layout.primary : layout.secondary;
  if (sameSelection(current, selection)) return layout;
  return paneId === "primary"
    ? { ...layout, primary: selection }
    : { ...layout, secondary: selection };
}

function withActivePane(layout: SplitLayout, paneId: PaneId): SplitLayout {
  return layout.activePaneId === paneId ? layout : { ...layout, activePaneId: paneId };
}

function selectInActivePane(layout: PaneLayout, selection: PaneSelection): PaneLayout {
  if (selection.kind === "session") {
    const visible = paneForSession(layout, selection.sessionId);
    if (visible !== undefined) return focusPane(layout, visible);
  }
  return selectInPane(layout, activePane(layout).id, selection);
}

function selectInPane(layout: PaneLayout, paneId: PaneId, selection: PaneSelection): PaneLayout {
  if (paneSelection(layout, paneId) === undefined) return layout;
  if (selection.kind === "session") {
    const visible = paneForSession(layout, selection.sessionId);
    if (visible !== undefined && visible !== paneId) return focusPane(layout, visible);
  }
  if (layout.kind === "single") {
    return sameSelection(layout.selection, selection) ? layout : { ...layout, selection };
  }
  return withActivePane(withPaneSelection(layout, paneId, selection), paneId);
}

function splitPane(layout: PaneLayout, direction: SplitDirection): PaneLayout {
  if (layout.kind === "split") return layout;
  return {
    kind: "split",
    direction,
    ratio: DEFAULT_SPLIT_RATIO,
    leading: layout.paneId,
    primary: layout.paneId === "primary" ? layout.selection : BLANK_SELECTION,
    secondary: layout.paneId === "secondary" ? layout.selection : BLANK_SELECTION,
    activePaneId: otherPaneId(layout.paneId),
  };
}

function closePane(layout: PaneLayout, paneId: PaneId): PaneLayout {
  if (layout.kind === "single") {
    if (layout.paneId !== paneId || layout.selection.kind === "blank") return layout;
    return { ...layout, selection: BLANK_SELECTION };
  }
  const survivor = otherPaneId(paneId);
  return {
    kind: "single",
    paneId: survivor,
    selection: survivor === "primary" ? layout.primary : layout.secondary,
  };
}

function focusPane(layout: PaneLayout, paneId: PaneId): PaneLayout {
  return layout.kind === "single" ? layout : withActivePane(layout, paneId);
}

function resizePane(layout: PaneLayout, ratio: number): PaneLayout {
  if (layout.kind === "single") return layout;
  const nextRatio = clampSplitRatio(ratio);
  return layout.ratio === nextRatio ? layout : { ...layout, ratio: nextRatio };
}

function dropInCenter(layout: PaneLayout, sessionId: SessionId, targetPaneId: PaneId): PaneLayout {
  const target = paneSelection(layout, targetPaneId);
  if (target === undefined) return layout;
  if (target.kind === "session" && target.sessionId === sessionId) return layout;
  const source = paneForSession(layout, sessionId);
  if (layout.kind === "split" && source !== undefined) {
    return withActivePane(
      { ...layout, primary: layout.secondary, secondary: layout.primary },
      targetPaneId,
    );
  }
  return selectInPane(layout, targetPaneId, { kind: "session", sessionId });
}

const EDGE_GEOMETRY = {
  left: { direction: "right", draggedLeads: true },
  right: { direction: "right", draggedLeads: false },
  top: { direction: "down", draggedLeads: true },
  bottom: { direction: "down", draggedLeads: false },
} satisfies Record<
  EdgeDropPlacement,
  { readonly direction: SplitDirection; readonly draggedLeads: boolean }
>;

function dropOnEdge(
  layout: PaneLayout,
  sessionId: SessionId,
  targetPaneId: PaneId,
  placement: EdgeDropPlacement,
): PaneLayout {
  const target = paneSelection(layout, targetPaneId);
  if (target === undefined) return layout;
  if (target.kind === "session" && target.sessionId === sessionId) return layout;
  const { direction, draggedLeads } = EDGE_GEOMETRY[placement];
  if (layout.kind === "single") {
    const draggedPaneId = otherPaneId(targetPaneId);
    const dragged: PaneSelection = { kind: "session", sessionId };
    return {
      kind: "split",
      direction,
      ratio: DEFAULT_SPLIT_RATIO,
      leading: draggedLeads ? draggedPaneId : targetPaneId,
      primary: targetPaneId === "primary" ? layout.selection : dragged,
      secondary: targetPaneId === "secondary" ? layout.selection : dragged,
      activePaneId: draggedPaneId,
    };
  }

  const source = paneForSession(layout, sessionId);
  const draggedPaneId = source ?? otherPaneId(targetPaneId);
  const leading = draggedLeads ? draggedPaneId : targetPaneId;
  if (source !== undefined && layout.direction === direction && layout.leading === leading) {
    return withActivePane(layout, draggedPaneId);
  }
  const next =
    source === undefined
      ? withPaneSelection(layout, draggedPaneId, { kind: "session", sessionId })
      : layout;
  return { ...next, direction, leading, activePaneId: draggedPaneId };
}

function dropSession(
  layout: PaneLayout,
  sessionId: SessionId,
  targetPaneId: PaneId,
  placement: DropPlacement,
): PaneLayout {
  return placement === "center"
    ? dropInCenter(layout, sessionId, targetPaneId)
    : dropOnEdge(layout, sessionId, targetPaneId, placement);
}

function removeSession(layout: PaneLayout, sessionId: SessionId): PaneLayout {
  const paneId = paneForSession(layout, sessionId);
  if (paneId === undefined) return layout;
  return selectInPane(layout, paneId, BLANK_SELECTION);
}

export function reducePaneLayout(layout: PaneLayout, action: PaneLayoutAction): PaneLayout {
  switch (action.kind) {
    case "select":
      return selectInActivePane(layout, action.selection);
    case "select-in-pane":
      return selectInPane(layout, action.paneId, action.selection);
    case "split":
      return splitPane(layout, action.direction);
    case "close":
      return closePane(layout, action.paneId);
    case "focus":
      return focusPane(layout, action.paneId);
    case "resize":
      return resizePane(layout, action.ratio);
    case "drop-session":
      return dropSession(layout, action.sessionId, action.targetPaneId, action.placement);
    case "remove-session":
      return removeSession(layout, action.sessionId);
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

const strict = { additionalProperties: false };
const paneIdSchema = Type.Enum(["primary", "secondary"]);
const directionSchema = Type.Enum(["right", "down"]);
const ratioSchema = Type.Number({ minimum: MIN_SPLIT_RATIO, maximum: MAX_SPLIT_RATIO });
const paneSelectionSchema = Type.Union([
  Type.Object({ kind: Type.Literal("blank") }, strict),
  Type.Object({ kind: Type.Literal("session"), sessionId }, strict),
]);
const persistedPaneLayoutSchema = Type.Union([
  Type.Object(
    {
      version: Type.Literal(2),
      kind: Type.Literal("single"),
      paneId: paneIdSchema,
      selection: paneSelectionSchema,
    },
    strict,
  ),
  Type.Object(
    {
      version: Type.Literal(2),
      kind: Type.Literal("split"),
      direction: directionSchema,
      ratio: ratioSchema,
      leading: paneIdSchema,
      primary: paneSelectionSchema,
      secondary: paneSelectionSchema,
      activePaneId: paneIdSchema,
    },
    strict,
  ),
]);

/** The version 1 shape, frozen: stored pane objects carried their own ids and a pane order. */
const legacyPaneSchema = Type.Object({ id: paneIdSchema, selection: paneSelectionSchema }, strict);
const legacyPaneLayoutSchema = Type.Union([
  Type.Object(
    { version: Type.Literal(1), kind: Type.Literal("single"), pane: legacyPaneSchema },
    strict,
  ),
  Type.Object(
    {
      version: Type.Literal(1),
      kind: Type.Literal("split"),
      direction: directionSchema,
      ratio: ratioSchema,
      order: Type.Tuple([paneIdSchema, paneIdSchema]),
      primary: legacyPaneSchema,
      secondary: legacyPaneSchema,
      activePaneId: paneIdSchema,
    },
    strict,
  ),
]);

function duplicatedSession(primary: PaneSelection, secondary: PaneSelection): boolean {
  return (
    primary.kind === "session" &&
    secondary.kind === "session" &&
    primary.sessionId === secondary.sessionId
  );
}

export function parsePersistedPaneLayout(value: string | null): PaneLayout {
  if (value === null) return createSinglePane();
  try {
    const persisted: unknown = JSON.parse(value);
    if (Value.Check(persistedPaneLayoutSchema, persisted)) {
      if (persisted.kind === "single") {
        return { kind: "single", paneId: persisted.paneId, selection: persisted.selection };
      }
      const { direction, ratio, leading, primary, secondary, activePaneId } = persisted;
      if (duplicatedSession(primary, secondary)) return createSinglePane();
      return { kind: "split", direction, ratio, leading, primary, secondary, activePaneId };
    }
    if (Value.Check(legacyPaneLayoutSchema, persisted)) {
      if (persisted.kind === "single") {
        return { kind: "single", paneId: persisted.pane.id, selection: persisted.pane.selection };
      }
      const { direction, ratio, order, primary, secondary, activePaneId } = persisted;
      if (duplicatedSession(primary.selection, secondary.selection)) return createSinglePane();
      return {
        kind: "split",
        direction,
        ratio,
        leading: order[0],
        primary: primary.selection,
        secondary: secondary.selection,
        activePaneId,
      };
    }
    return createSinglePane();
  } catch {
    return createSinglePane();
  }
}

export function serializePaneLayout(layout: PaneLayout): string {
  return JSON.stringify({ version: 2, ...layout });
}
