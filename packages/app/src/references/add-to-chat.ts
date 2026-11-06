import type { MentionFile } from "../data/files.ts";
import type { MessageReference } from "./message-references.ts";

export interface ChatExcerpt {
  readonly reference: MessageReference;
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

export function addFileToChat(
  file: Pick<MentionFile, "path" | "displayPath">,
  lines?: { readonly start: number; readonly end: number },
): boolean {
  const url = new URL("file:///");
  url.pathname = file.path;

  return addToChat({
    reference: {
      kind: "file",
      file: {
        path: file.path,
        url: url.href,
        displayPath: file.displayPath,
        label: file.displayPath.split("/").at(-1) ?? file.displayPath,
      },
      lines,
    },
  });
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
