import type { Message, SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { showsText, showsTool } from "@nyte-ai/plugin/client/presentation";
import { errorMessage } from "../../contract/errors.ts";
import { connected } from "../../data/connection.ts";
import { pendingConfigurations, projectSessionChoice } from "../../data/session-configuration.ts";
import { chatStore, warmSession } from "../../data/chat-store.ts";
import { childList } from "../../data/directory.ts";
import { useWatch } from "../../data/watch-store.ts";
import { contentDraftText } from "../../references/message-references.ts";
import type { ExcerptReference } from "../../references/message-references.ts";
import { CLOSED, chatWindow, useChatWindow } from "../../window/index.ts";
import type { SideChatShown, SideChatWindow } from "../../window/index.ts";

const CONTEXT_CHARS = 24_000;

const FRAMING = [
  "You are in a side chat beside the user's main chat. The main chat may still be running in the same workspace.",
  "Answer the user's questions about it. Read and search the workspace when it helps, but don't edit files, run commands that change anything, or carry on the main chat's task.",
  "The main chat's recent history, as it stood when this side chat opened, is below. It may have moved on since.",
].join(" ");

export function useSideChatWindow(parent: SessionId): SideChatWindow {
  return useChatWindow((snapshot) => snapshot.sides.get(parent) ?? CLOSED);
}

export function useSideChats(parent: SessionId): readonly SessionInfo[] {
  return sideChats(useWatch(childList(parent)).value ?? []);
}

function sideChats(children: readonly SessionInfo[]): readonly SessionInfo[] {
  return children
    .filter((child) => child.side === true && !child.archived)
    .toSorted((left, right) => left.createdAt - right.createdAt);
}

export function openSideChat(parent: SessionId, question: string): Promise<void> {
  if (question.trim() === "") {
    chatWindow.moveSideChat(parent, { kind: "open", shown: newQuestion("", null) });

    return Promise.resolve();
  }

  return startSideChat(parent, question.trim());
}

export function summonSideChat(parent: SessionId): void {
  chatWindow.moveSideChat(parent, {
    kind: "summon",
    newest: sideChats(childList(parent).value ?? []).at(-1)?.id,
    blank: newQuestion("", null),
  });
}

export function showSideChat(parent: SessionId, id: SessionId): void {
  chatWindow.moveSideChat(parent, { kind: "open", shown: { kind: "chat", id } });
}

export function foldSideChat(parent: SessionId, folded: boolean): void {
  chatWindow.moveSideChat(parent, { kind: "fold", folded });
}

export async function startSideChat(parent: SessionId, question: string): Promise<void> {
  const starting: SideChatShown = { kind: "starting", question };
  chatWindow.moveSideChat(parent, { kind: "open", shown: starting });
  const id = asId<"session">(crypto.randomUUID());
  const view = chatStore(parent).value;

  const choice =
    view === undefined ? undefined : projectSessionChoice(view, pendingConfigurations(parent));

  try {
    const connection = await connected();

    const configuration =
      choice?.model === undefined ? undefined : { model: choice.model, thinking: choice.thinking };

    await connection.sessions.start({
      id,
      parent,
      name: question,
      prompt: { kind: "layer", text: sideChatPrompt(view?.messages ?? []) },
      configuration,
      side: true,
      content: question,
    });
    warmSession(id);
    await chatStore(id)
      .until(() => true)
      .catch(() => undefined);
    chatWindow.moveSideChat(parent, { kind: "replace", from: starting, to: { kind: "chat", id } });
  } catch (cause: unknown) {
    chatWindow.moveSideChat(parent, {
      kind: "replace",
      from: starting,
      to: newQuestion(question, `Couldn't start the side chat: ${errorMessage(cause)}`),
    });
  }
}

export async function archiveSideChat(parent: SessionId, id: SessionId): Promise<void> {
  const before = chatWindow.sideChat(parent);
  chatWindow.moveSideChat(parent, { kind: "archive", id });
  const closed = chatWindow.sideChat(parent) === before ? undefined : before;

  try {
    await (await connected()).session(id).update({ archived: true });
  } catch {
    if (closed !== undefined) chatWindow.moveSideChat(parent, { kind: "restore", window: closed });
  }
}

function sideChatPrompt(messages: readonly Message[]): string {
  return `${FRAMING}\n\n<main_chat>\n${conversationText(messages, CONTEXT_CHARS)}\n</main_chat>`;
}

export function sideChatExcerpt(
  session: SessionId,
  title: string,
  view: Pick<SessionView, "messages"> | undefined,
): ExcerptReference {
  return {
    kind: "excerpt",
    source: { kind: "chat", session, title },
    text: conversationText(view?.messages ?? [], Infinity),
  };
}

function conversationText(messages: readonly Message[], budget: number): string {
  const kept: string[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const line = message === undefined ? null : messageLine(message);

    if (line === null) continue;

    if (kept.length === 0 && line.length > budget) {
      kept.push(`…${line.slice(line.length - budget)}`);
      break;
    }

    if (used + line.length > budget) break;
    kept.push(line);
    used += line.length + 2;
  }

  return kept.reverse().join("\n\n");
}

function messageLine(message: Message): string | null {
  if (message.kind === "user") return `User: ${contentDraftText(message.content)}`;

  if (showsText(message)) return `Assistant: ${message.state.markdown}`;

  return showsTool(message) ? `[${message.state.name}]` : null;
}

function newQuestion(question: string, error: string | null): SideChatShown {
  return { kind: "new", id: crypto.randomUUID(), error, question };
}
