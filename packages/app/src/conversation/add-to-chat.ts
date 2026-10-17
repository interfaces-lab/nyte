/**
 * Add to Chat: a workbench panel hands what the user picked in it to the
 * active pane's composer, which inserts it as a chip. Every panel runs it from
 * the same chord, ⇧⌘L (Ctrl+Shift+L elsewhere), so the key means one thing
 * in a diff, a terminal and a page.
 */
import type { ExcerptReference } from "./message-references.ts";

export interface ChatExcerpt {
  readonly reference: ExcerptReference;
  /** What the excerpt looks like on screen, attached beside its chip where the model reads images. */
  readonly image?: File;
}

type ChatExcerptReceiver = (excerpt: ChatExcerpt) => void;

let receiver: ChatExcerptReceiver | undefined;

/** The active pane's composer takes what a panel adds; a newer composer replaces an older one. */
export function receiveChatExcerpts(receive: ChatExcerptReceiver): () => void {
  receiver = receive;

  return () => {
    if (receiver === receive) receiver = undefined;
  };
}

/** Adds an excerpt to the active chat's draft; false when no composer is there to take it. */
export function addToChat(excerpt: ChatExcerpt): boolean {
  if (receiver === undefined) return false;
  receiver(excerpt);

  return true;
}

export const ADD_TO_CHAT_LABEL = "Add to Chat";

/** ⇧⌘L on a Mac, Ctrl+Shift+L elsewhere. */
export function addsToChat(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
): boolean {
  return (
    event.code === "KeyL" &&
    event.shiftKey &&
    !event.altKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  );
}

export function addToChatShortcut(mac: boolean): string {
  return mac ? "⇧⌘L" : "Ctrl+Shift+L";
}
