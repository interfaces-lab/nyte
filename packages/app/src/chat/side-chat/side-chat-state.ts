import type { SessionId } from "@nyte-ai/sdk";

export type SideChatShown =
  | {
      readonly kind: "new";
      readonly id: string;
      readonly error: string | null;
      readonly question: string;
    }
  | { readonly kind: "starting"; readonly question: string }
  | { readonly kind: "chat"; readonly id: SessionId };

export type SideChatWindow =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly shown: SideChatShown; readonly folded: boolean };

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
