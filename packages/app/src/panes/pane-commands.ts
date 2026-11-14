import type { ClientRect } from "@dnd-kit/core";
import type { SessionId } from "@nyte-ai/sdk";
import { layoutPanes } from "./layout.ts";
import type { Layout, LayoutAction, PaneId, SplitDirection } from "./layout.ts";
import type { Box, Linear } from "./pane-geometry.ts";
import type { PaneContent } from "./pane-kinds.ts";
import {
  activeSelection,
  chatContent,
  chatPanes,
  findSessionTab,
  focusedChat,
  paneForSession,
  showChat,
} from "./pane-layout.ts";
import type { DropPlacement, PaneSelection } from "./pane-layout.ts";
import { placementInRect } from "./session-dnd-geometry.ts";
import type { SessionDragPoint } from "./session-dnd-geometry.ts";
import type { ChatDraft } from "./session-view-state.ts";

/**
 * What a person asks of the panes. `show` opens a new pane tab in the focused pane, so its chat
 * mounts afresh; `show-in` swaps the content of the pane's tab, so the pane stays mounted. `unhide`
 * is refused, with no actions, when the pane now shows something else or its blank draft has text.
 */
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

/** Hiding a chat keeps DOM focus where it is; every other command follows the change. */
export function commandFocus(command: PaneCommand): PaneFocus {
  return command.kind === "hide" ? "never" : "if-changed";
}

/**
 * The pane to move DOM focus to once a command turned `before` into `after`: the focused chat's
 * pane when the layout changed, the focused pane when the command always focuses, and none
 * otherwise.
 */
export function focusRequest(
  before: Layout<PaneContent>,
  after: Layout<PaneContent>,
  focus: PaneFocus,
): PaneId | undefined {
  if (focus === "never") return undefined;

  if (after !== before) return focusedChat(after)?.pane ?? after.focus[0];

  return focus === "always" ? after.focus[0] : undefined;
}

/**
 * Where a chat dragged to `point` would land: the first pane whose rect holds the point, unless it
 * already shows the dragged chat. A lone pane offers only its edges.
 */
export function dropTarget(
  layout: Layout<PaneContent>,
  rects: ReadonlyMap<PaneId, ClientRect>,
  point: SessionDragPoint,
  dragged: SessionId,
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

  return placement === undefined ? undefined : { paneId: hit.pane.pane, placement };
}

export function dropPreviewBox(box: Box, target: SessionDropTarget): Box {
  switch (target.placement) {
    case "center":
      return box;
    case "left":
      return { ...box, width: half(box.width) };
    case "right":
      return { ...box, x: plus(box.x, half(box.width)), width: half(box.width) };
    case "top":
      return { ...box, height: half(box.height) };
    case "bottom":
      return { ...box, y: plus(box.y, half(box.height)), height: half(box.height) };
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

/** The last pane turns blank instead of closing. */
function closePane(
  layout: Layout<PaneContent>,
  pane: PaneId,
): readonly LayoutAction<PaneContent>[] {
  const closing = layoutPanes(layout.root).find((entry) => entry.id === pane);

  if (closing === undefined) return [];

  if (layoutPanes(layout.root).length === 1) return inPane(layout, pane, BLANK);

  return closing.tabs.map((tab) => ({ kind: "close", tab: tab.id }));
}

/**
 * A center drop swaps with the pane already showing the chat, or replaces the target's chat; an
 * edge drop moves that pane's tab there, or opens the chat there. A drop on the chat's own pane does
 * nothing.
 */
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

/** Keeps focus where it is unless the focused pane is blank, then returns it to `focused`. */
function unhideSession(
  layout: Layout<PaneContent>,
  command: Extract<PaneCommand, { readonly kind: "unhide" }>,
  blank: (pane: PaneId) => ChatDraft,
): readonly LayoutAction<PaneContent>[] {
  const shown = chatPanes(layout).find((entry) => entry.pane === command.pane);

  if (shown?.selection.kind !== "blank") return [];

  const composer = blank(command.pane).composer;

  if (composer.draft !== "" || composer.attachments.length > 0) return [];
  const keep = activeSelection(layout).kind === "blank" ? command.focused : layout.focus[0];

  return [
    ...inPane(layout, command.pane, { kind: "session", sessionId: command.sessionId }),
    { kind: "focus", pane: keep },
  ];
}

function half(value: Linear): Linear {
  return { px: value.px / 2, fraction: value.fraction / 2, gaps: value.gaps / 2 };
}

function plus(left: Linear, right: Linear): Linear {
  return {
    px: left.px + right.px,
    fraction: left.fraction + right.fraction,
    gaps: left.gaps + right.gaps,
  };
}
