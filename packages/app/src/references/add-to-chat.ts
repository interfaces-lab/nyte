import { mentionFileAt } from "../data/files.ts";
import type { MentionFile } from "../data/files.ts";
import type { MessageReference } from "./message-references.ts";

export type ChatExcerpt =
  | { readonly reference: MessageReference; readonly image?: File; readonly signal?: AbortSignal }
  | { readonly image: File; readonly signal?: AbortSignal };

type ChatExcerptReceiver = (excerpt: ChatExcerpt) => HTMLElement | false | Promise<HTMLElement>;

let receiver: ChatExcerptReceiver | undefined;

let showChat: (() => void) | undefined;

export const NO_CHAT = "Open a chat, then try again.";

export function receiveChatExcerpts(receive: ChatExcerptReceiver): () => void {
  receiver = receive;

  return () => {
    if (receiver === receive) receiver = undefined;
  };
}

/** Shows the chat before an excerpt goes in, so it never lands in a composer the workbench covers. */
export function showChatForExcerpts(show: () => void): () => void {
  showChat = show;

  return () => {
    if (showChat === show) showChat = undefined;
  };
}

export function addToChat(excerpt: {
  readonly image: File;
  readonly signal?: AbortSignal;
}): Promise<HTMLElement>;
export function addToChat(excerpt: { readonly reference: MessageReference }): boolean;
export function addToChat(excerpt: ChatExcerpt): boolean | Promise<HTMLElement>;
export function addToChat(excerpt: ChatExcerpt): boolean | Promise<HTMLElement> {
  showChat?.();
  const result = receiver?.(excerpt) ?? false;

  if (excerpt.image === undefined) return result !== false;

  return Promise.resolve(result).then((target) => {
    if (target === false) throw new Error(NO_CHAT);

    return target;
  });
}

export function addFileToChat(
  file: Pick<MentionFile, "path" | "displayPath">,
  lines?: { readonly start: number; readonly end: number },
): boolean {
  return addToChat({
    reference: {
      kind: "file",
      file: { ...mentionFileAt(file.path, "file"), displayPath: file.displayPath },
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
