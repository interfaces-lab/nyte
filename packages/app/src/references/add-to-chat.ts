import type { ExcerptReference } from "./message-references.ts";

export interface ChatExcerpt {
  readonly reference: ExcerptReference;
  readonly image?: File;
}

type ChatExcerptReceiver = (excerpt: ChatExcerpt) => void;

let receiver: ChatExcerptReceiver | undefined;

export function receiveChatExcerpts(receive: ChatExcerptReceiver): () => void {
  receiver = receive;

  return () => {
    if (receiver === receive) receiver = undefined;
  };
}

export function addToChat(excerpt: ChatExcerpt): boolean {
  if (receiver === undefined) return false;
  receiver(excerpt);

  return true;
}

export const ADD_TO_CHAT_LABEL = "Add to Chat";

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
