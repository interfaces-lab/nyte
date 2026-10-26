import type { SessionId } from "@nyte-ai/sdk";
import type { PaneLayout, SplitDirection } from "../layout/pane-layout.ts";

/** A tab is a chat. Opening a chat that already has a tab switches to it. */
export type Chat =
  | { readonly kind: "session"; readonly sessionId: SessionId }
  | { readonly kind: "draft"; readonly draftId: string };

/** Full-tab pages that are always in the strip and never close. */
export type PinnedPlace = "customize" | "environments" | "inbox";

export const PINNED: readonly PinnedPlace[] = ["customize", "environments", "inbox"];

export type TabTarget =
  | { readonly kind: "chat"; readonly chat: Chat }
  | { readonly kind: "pinned"; readonly place: PinnedPlace };

/** A second chat shown beside the tab's own. The URL always names the tab's own chat. */
export interface TabSplit {
  readonly secondary: Chat;
  readonly direction: SplitDirection;
  readonly ratio: number;
  readonly secondaryLeads: boolean;
  readonly focus: "own" | "secondary";
}

export interface ChatTab {
  readonly chat: Chat;
  readonly split: TabSplit | undefined;
}

export interface ClosedTab {
  readonly tab: ChatTab;
  readonly index: number;
}

/**
 * The window's strip. The active tab is not stored: it is whatever the URL names, so the
 * router and the strip can't disagree.
 */
export interface Strip {
  readonly tabs: readonly ChatTab[];
  /** The key of the tab the next preview open replaces. */
  readonly preview: string | undefined;
  /** Tab keys and pinned places, most recent first. Closing the active tab goes to the head. */
  readonly recent: readonly string[];
  readonly closed: readonly ClosedTab[];
}

/**
 * preview: a plain click in the sidebar or search; fills the preview slot.
 * keep: ⌘⇧-click and New Chat; a real tab, switched to.
 * background: ⌘-click and middle click; a real tab after the active one, not switched to.
 */
export type OpenMode = "preview" | "keep" | "background";

export type StripAction =
  | { readonly kind: "open"; readonly target: TabTarget; readonly mode: OpenMode }
  /** The router resolved here: deep link, notification, reload. Adds a preview tab if none. */
  | { readonly kind: "visited"; readonly target: TabTarget }
  /** Promote the preview tab: a sent message, a double click, a composer edit. */
  | { readonly kind: "keep"; readonly key: string }
  | { readonly kind: "new-tab" }
  /** A draft's first message created a session; the tab keeps its slot. */
  | { readonly kind: "replace-chat"; readonly from: Chat; readonly to: Chat }
  | { readonly kind: "split"; readonly key: string; readonly split: TabSplit | undefined }
  | { readonly kind: "forget-session"; readonly sessionId: SessionId }
  | { readonly kind: "close"; readonly key: string }
  | { readonly kind: "close-others"; readonly key: string }
  | { readonly kind: "close-right"; readonly key: string }
  | { readonly kind: "reopen" }
  | { readonly kind: "reorder"; readonly keys: readonly string[] }
  | { readonly kind: "activate-index"; readonly index: number }
  | { readonly kind: "cycle"; readonly step: 1 | -1 };

/** The reducer never navigates; it says where to go and the store moves the router. */
export interface StripStep {
  readonly strip: Strip;
  readonly go: TabTarget | undefined;
}

export const EMPTY_STRIP: Strip = { tabs: [], preview: undefined, recent: [], closed: [] };

export function chatKey(chat: Chat): string {
  return chat.kind === "session" ? `session:${chat.sessionId}` : `draft:${chat.draftId}`;
}

export function targetKey(target: TabTarget): string {
  return target.kind === "chat" ? chatKey(target.chat) : target.place;
}

/** Pinned places, then chat tabs: the order ⌘1–9 and ⌃Tab walk. */
export function stripTargets(strip: Strip): readonly TabTarget[] {
  return [
    ...PINNED.map((place): TabTarget => ({ kind: "pinned", place })),
    ...strip.tabs.map((tab): TabTarget => ({ kind: "chat", chat: tab.chat })),
  ];
}

/** The pane layout a tab shows. A draft pane renders as blank with its draft id. */
export function tabLayout(tab: ChatTab): PaneLayout {
  void tab;
  throw new Error("not implemented");
}

export function reduceStrip(
  strip: Strip,
  here: TabTarget | undefined,
  action: StripAction,
  createDraftId: () => string,
): StripStep {
  void strip;
  void here;
  void action;
  void createDraftId;
  throw new Error("not implemented");
}
