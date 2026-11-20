import type { ClientRect } from "@dnd-kit/core";
import type { SessionId } from "@nyte-ai/sdk";
import { layoutPanes } from "./layout.ts";
import type { Layout, LayoutAction, PaneId, SplitDirection } from "./layout.ts";
import type { Box } from "./pane-geometry.ts";
import { add, scale } from "./piecewise.ts";
import type { PaneContent } from "./pane-kinds.ts";
import {
  activeSelection,
  canSplitPane,
  chatContent,
  chatPanes,
  findSessionTab,
  focusedChat,
  paneForSession,
  showChat,
} from "./pane-layout.ts";
import type { ChatPane, DropPlacement, PaneSelection } from "./pane-layout.ts";
import { placementInRect } from "./session-dnd-geometry.ts";
import type { SessionDragPoint } from "./session-dnd-geometry.ts";
import type { ChatDraft } from "./session-view-state.ts";

export type PaneCommand =
  | { readonly kind: "show"; readonly selection: PaneSelection }
  | { readonly kind: "show-in"; readonly pane: PaneId; readonly selection: PaneSelection }
  | { readonly kind: "split"; readonly direction: SplitDirection }
  | { readonly kind: "close"; readonly pane: PaneId }
  | { readonly kind: "focus"; readonly pane: PaneId }
  | {
      readonly kind: "drop";
      readonly sessionId: SessionId;
      readonly pane: PaneId;
      readonly placement: DropPlacement;
    }
  | { readonly kind: "hide"; readonly sessionId: SessionId }
  | {
      readonly kind: "unhide";
      readonly sessionId: SessionId;
      readonly pane: PaneId;
      readonly focused: PaneId;
    };

export type PaneFocus = "if-changed" | "always" | "never";

export interface PanePlan {
  readonly actions: readonly LayoutAction<PaneContent>[];
  readonly focus: PaneFocus;
}

export interface SessionDropTarget {
  readonly paneId: PaneId;
  readonly placement: DropPlacement;
}

const BLANK: PaneSelection = { kind: "blank" };

const EDGES = {
  left: { direction: "right", side: "before" },
  right: { direction: "right", side: "after" },
  top: { direction: "down", side: "before" },
  bottom: { direction: "down", side: "after" },
} as const satisfies Record<
  Exclude<DropPlacement, "center">,
  { readonly direction: SplitDirection; readonly side: "before" | "after" }
>;

export function planPane(
  layout: Layout<PaneContent>,
  command: PaneCommand,
  blank: (pane: PaneId) => ChatDraft,
): PanePlan {
  return { actions: paneActions(layout, command, blank), focus: commandFocus(command) };
}

export function commandFocus(command: PaneCommand): PaneFocus {
  return command.kind === "hide" ? "never" : "if-changed";
}

export function focusRequest(
  before: Layout<PaneContent>,
  after: Layout<PaneContent>,
  focus: PaneFocus,
): PaneId | undefined {
  if (focus === "never") return undefined;

  if (after !== before) return focusedChat(after)?.pane ?? after.focus[0];

  return focus === "always" ? after.focus[0] : undefined;
}

export function dropTarget(
  layout: Layout<PaneContent>,
  rects: ReadonlyMap<PaneId, ClientRect>,
  point: SessionDragPoint,
  dragged: SessionId,
  width: number,
): SessionDropTarget | undefined {
  const panes = chatPanes(layout);

  const hit = panes.flatMap((pane) => {
    const rect = rects.get(pane.pane);

    return rect === undefined ||
      point.x < rect.left ||
      point.x > rect.right ||
      point.y < rect.top ||
      point.y > rect.bottom
      ? []
      : [{ pane, rect }];
  })[0];

  if (
    hit === undefined ||
    (hit.pane.selection.kind === "session" && hit.pane.selection.sessionId === dragged)
  )
    return undefined;
  const placement = placementInRect(hit.rect, point, panes.length > 1);

  if (placement === undefined) return undefined;
  const splits = findSessionTab(layout, dragged) !== undefined || canSplitPane(layout, width);

  return { paneId: hit.pane.pane, placement: splits ? placement : "center" };
}

export function dropPreviewBox(box: Box, target: SessionDropTarget): Box {
  switch (target.placement) {
    case "center":
      return box;
    case "left":
      return { ...box, width: scale(box.width, 0.5) };
    case "right":
      return { ...box, x: add(box.x, scale(box.width, 0.5)), width: scale(box.width, 0.5) };
    case "top":
      return { ...box, height: scale(box.height, 0.5) };
    case "bottom":
      return { ...box, y: add(box.y, scale(box.height, 0.5)), height: scale(box.height, 0.5) };
    default: {
      const _exhaustive: never = target.placement;

      return _exhaustive;
    }
  }
}

function paneActions(
  layout: Layout<PaneContent>,
  command: PaneCommand,
  blank: (pane: PaneId) => ChatDraft,
): readonly LayoutAction<PaneContent>[] {
  switch (command.kind) {
    case "show":
      return showChat(layout, command.selection);
    case "show-in":
      return inPane(layout, command.pane, command.selection);
    case "split":
      return [
        {
          kind: "open",
          content: chatContent(BLANK),
          place: {
            kind: "edge",
            pane: layout.focus[0],
            direction: command.direction,
            side: "after",
          },
        },
      ];
    case "close":
      return closePane(layout, command.pane);
    case "focus":
      return [{ kind: "focus", pane: command.pane }];
    case "drop":
      return dropSession(layout, command.sessionId, command.pane, command.placement);
    case "hide": {
      const pane = paneForSession(layout, command.sessionId);

      return pane === undefined
        ? []
        : [...inPane(layout, pane, BLANK), { kind: "focus", pane: layout.focus[0] }];
    }

    case "unhide":
      return unhideSession(layout, command, blank);
    default: {
      const _exhaustive: never = command;

      return _exhaustive;
    }
  }
}

function inPane(
  layout: Layout<PaneContent>,
  pane: PaneId,
  selection: PaneSelection,
): readonly LayoutAction<PaneContent>[] {
  const target = chatPanes(layout).find((entry) => entry.pane === pane);

  if (target === undefined) return [];

  const shown =
    selection.kind === "session" ? paneForSession(layout, selection.sessionId) : undefined;

  if (shown !== undefined) return [{ kind: "focus", pane: shown }];

  return [
    { kind: "set-content", tab: target.tab, content: chatContent(selection) },
    { kind: "focus", pane },
  ];
}

function closePane(
  layout: Layout<PaneContent>,
  pane: PaneId,
): readonly LayoutAction<PaneContent>[] {
  const closing = layoutPanes(layout.root).find((entry) => entry.id === pane);

  if (closing === undefined) return [];

  if (layoutPanes(layout.root).length === 1) return inPane(layout, pane, BLANK);

  return [{ kind: "close", tab: closing.tab.id }];
}

function dropSession(
  layout: Layout<PaneContent>,
  sessionId: SessionId,
  pane: PaneId,
  placement: DropPlacement,
): readonly LayoutAction<PaneContent>[] {
  const target = chatPanes(layout).find((entry) => entry.pane === pane);
  const source = findSessionTab(layout, sessionId);

  if (target === undefined || source?.pane === pane) return [];
  const selection: PaneSelection = { kind: "session", sessionId };

  if (placement === "center")
    return source === undefined
      ? inPane(layout, pane, selection)
      : [
          { kind: "set-content", tab: target.tab, content: chatContent(selection) },
          { kind: "set-content", tab: source.tab, content: chatContent(target.selection) },
          { kind: "focus", pane },
        ];

  const place = { kind: "edge", pane, ...EDGES[placement] } as const;

  return [
    source === undefined
      ? { kind: "open", content: chatContent(selection), place }
      : { kind: "move", tab: source.tab, place },
  ];
}

export function waitsForChat(pane: ChatPane, draft: ChatDraft): boolean {
  return (
    pane.selection.kind === "blank" &&
    draft.composer.draft === "" &&
    draft.composer.attachments.length === 0
  );
}

function unhideSession(
  layout: Layout<PaneContent>,
  command: Extract<PaneCommand, { readonly kind: "unhide" }>,
  blank: (pane: PaneId) => ChatDraft,
): readonly LayoutAction<PaneContent>[] {
  const shown = chatPanes(layout).find((entry) => entry.pane === command.pane);

  if (shown === undefined || !waitsForChat(shown, blank(command.pane))) return [];
  const keep = activeSelection(layout).kind === "blank" ? command.focused : layout.focus[0];

  return [
    ...inPane(layout, command.pane, { kind: "session", sessionId: command.sessionId }),
    { kind: "focus", pane: keep },
  ];
}
