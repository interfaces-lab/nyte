import type { SessionId } from "@nyte-ai/sdk";

/**
 * What a chat's side-chat window shows: a question not yet asked, one being started, or a side chat.
 * A new one's `question` is the draft it opens with, the question back after a start failed.
 */
export type SideChatShown =
  | {
      readonly kind: "new";
      readonly id: string;
      readonly error: string | null;
      readonly question: string;
    }
  | { readonly kind: "starting"; readonly question: string }
  | { readonly kind: "chat"; readonly id: SessionId };

/**
 * A chat's side-chat window. Side chats are new chats a person starts beside a chat, to ask about
 * it without steering it: ordinary sessions whose `parent` is that chat. Each starts with the
 * chat's recent history as hidden context in its prompt, never in its transcript, and lasts until
 * it is archived. It reaches its parent only as a `chat` excerpt someone adds to a message there.
 */
export type SideChatWindow =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly shown: SideChatShown; readonly folded: boolean };

/**
 * `replace` lands a start only while the window still shows that start, so a start that finishes
 * after someone moved the window off it leaves the window where they put it. `restore` reopens a
 * window an archive closed only while it is still closed.
 */
export type SideChatEvent =
  | { readonly kind: "open"; readonly shown: SideChatShown }
  | {
      readonly kind: "summon";
      readonly newest: SessionId | undefined;
      readonly blank: SideChatShown;
    }
  | { readonly kind: "fold"; readonly folded: boolean }
  | { readonly kind: "replace"; readonly from: SideChatShown; readonly to: SideChatShown }
  | { readonly kind: "archive"; readonly id: SessionId }
  | { readonly kind: "restore"; readonly window: SideChatWindow };

export const CLOSED: SideChatWindow = { kind: "closed" };

/** The window after `event`; the same object when the event changes nothing. */
export function nextSideChat(window: SideChatWindow, event: SideChatEvent): SideChatWindow {
  switch (event.kind) {
    case "open":
      return { kind: "open", shown: event.shown, folded: false };
    case "summon":
      if (window.kind === "open") return { ...window, folded: false };

      return {
        kind: "open",
        shown: event.newest === undefined ? event.blank : { kind: "chat", id: event.newest },
        folded: false,
      };
    case "fold":
      return window.kind === "open" ? { ...window, folded: event.folded } : window;
    case "replace":
      return window.kind === "open" && window.shown === event.from
        ? { ...window, shown: event.to }
        : window;
    case "archive":
      return window.kind === "open" && window.shown.kind === "chat" && window.shown.id === event.id
        ? CLOSED
        : window;
    case "restore":
      return window.kind === "closed" ? event.window : window;
    default: {
      const exhaustive: never = event;

      return exhaustive;
    }
  }
}
