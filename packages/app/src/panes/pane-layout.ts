import type { SessionId } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { sessionId } from "../data/schemas.ts";
import { activeTab, focusedPane, layoutPanes, MAX_PANES } from "./layout.ts";
import type { Layout, LayoutAction, Pane, PaneId, PaneTabId } from "./layout.ts";
import type { PaneContent } from "./pane-kinds.ts";

export type DropPlacement = "center" | "top" | "bottom" | "left" | "right";

export type PaneSelection =
  | { readonly kind: "blank" }
  | { readonly kind: "session"; readonly sessionId: SessionId };

/** The chat a pane shows: its active tab, when that tab is a chat. */
export interface ChatPane {
  readonly pane: PaneId;
  readonly tab: PaneTabId;
  readonly selection: PaneSelection;
}

/** No pane is drawn or resized smaller than this along either axis. */
export const MIN_PANE_SIZE = 320;

const BLANK: PaneSelection = { kind: "blank" };

export function sameSelection(left: PaneSelection, right: PaneSelection): boolean {
  if (left.kind !== right.kind) return false;

  if (left.kind === "blank" || right.kind === "blank") return true;

  return left.sessionId === right.sessionId;
}

export function chatContent(selection: PaneSelection): PaneContent<"chat"> {
  return { kind: "chat", fields: { selection } };
}

export function shownChat(pane: Pane<PaneContent>): ChatPane | undefined {
  const tab = activeTab(pane);

  return tab.content.kind === "chat"
    ? { pane: pane.id, tab: tab.id, selection: tab.content.fields.selection }
    : undefined;
}

/** The chat each pane shows, in reading order. */
export function chatPanes(layout: Layout<PaneContent>): readonly ChatPane[] {
  return layoutPanes(layout.root).flatMap((pane) => shownChat(pane) ?? []);
}

export function focusedChat(layout: Layout<PaneContent>): ChatPane | undefined {
  return shownChat(focusedPane(layout));
}

/** What the focused pane shows; a pane showing something other than a chat counts as a new chat. */
export function activeSelection(layout: Layout<PaneContent>): PaneSelection {
  return focusedChat(layout)?.selection ?? BLANK;
}

/** The chat tab showing `id`, active in its pane or not. */
export function findSessionTab(
  layout: Layout<PaneContent>,
  id: SessionId,
): { readonly pane: PaneId; readonly tab: PaneTabId } | undefined {
  return layoutPanes(layout.root)
    .flatMap((pane) =>
      pane.tabs.map((tab) => ({ pane: pane.id, tab: tab.id, content: tab.content })),
    )
    .find(
      (entry) =>
        entry.content.kind === "chat" &&
        entry.content.fields.selection.kind === "session" &&
        entry.content.fields.selection.sessionId === id,
    );
}

export function paneForSession(layout: Layout<PaneContent>, id: SessionId): PaneId | undefined {
  return findSessionTab(layout, id)?.pane;
}

/** Shows `selection` in the focused pane; a chat already open in another pane gets the focus instead. */
export function showChat(
  layout: Layout<PaneContent>,
  selection: PaneSelection,
): readonly LayoutAction<PaneContent>[] {
  return sameSelection(activeSelection(layout), selection)
    ? []
    : [
        {
          kind: "open",
          content: chatContent(selection),
          place: { kind: "focused" },
          activate: true,
        },
      ];
}

/** Room for one more chat pane at its minimum width. */
export function canSplitPane(layout: Layout<PaneContent>, windowWidth: number): boolean {
  return (
    layoutPanes(layout.root).length < MAX_PANES &&
    (chatPanes(layout).length + 1) * MIN_PANE_SIZE <= windowWidth
  );
}

const strict = { additionalProperties: false };

export const paneSelectionSchema = Type.Union([
  Type.Object({ kind: Type.Literal("blank") }, strict),
  Type.Object({ kind: Type.Literal("session"), sessionId }, strict),
]);
