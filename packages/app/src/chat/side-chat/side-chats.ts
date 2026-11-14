import { useSyncExternalStore } from "react";
import type { Message, SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { showsText, showsTool } from "@nyte-ai/plugin/client/presentation";
import { errorMessage } from "../../contract/errors.ts";
import { connected } from "../../data/connection.ts";
import { projectSessionChoice } from "../../data/session-configuration.ts";
import { chatStore, warmSession } from "../../data/chat-store.ts";
import { childList } from "../../data/directory.ts";
import { useWatch } from "../../data/watch-store.ts";
import { contentDraftText } from "../../references/message-references.ts";
import type { ExcerptReference } from "../../references/message-references.ts";
import { CLOSED, nextSideChat } from "./side-chat-state.ts";
import type { SideChatEvent, SideChatShown, SideChatWindow } from "./side-chat-state.ts";

/** The most of the parent's history a side chat starts with, counted back from its newest message. */
const CONTEXT_CHARS = 24_000;

const FRAMING = [
  "You are in a side chat beside the user's main chat. The main chat may still be running in the same workspace.",
  "Answer the user's questions about it. Read and search the workspace when it helps, but don't edit files, run commands that change anything, or carry on the main chat's task.",
  "The main chat's recent history, as it stood when this side chat opened, is below. It may have moved on since.",
].join(" ");

/**
 * One chat's window: its state and the windows listening to it, kept for the app's lifetime.
 * `subscribe` is made with the slot, so React keeps one subscription per chat and a change wakes
 * only that chat's listeners.
 */
interface Slot {
  state: SideChatWindow;
  readonly listeners: Set<() => void>;
  readonly subscribe: (listener: () => void) => () => void;
}

const slots = new Map<SessionId, Slot>();

/** The side-chat window of `parent`'s chat. */
export function useSideChatWindow(parent: SessionId): SideChatWindow {
  const slot = slotFor(parent);

  return useSyncExternalStore(
    slot.subscribe,
    () => slot.state,
    () => CLOSED,
  );
}

/** `parent`'s side chats that aren't archived, oldest first. */
export function useSideChats(parent: SessionId): readonly SessionInfo[] {
  return sideChats(useWatch(childList(parent)).value ?? []);
}

/** The side chats among a chat's children that aren't archived, oldest first. */
function sideChats(children: readonly SessionInfo[]): readonly SessionInfo[] {
  return children
    .filter((child) => child.side === true && !child.archived)
    .toSorted((left, right) => left.createdAt - right.createdAt);
}

/** Opens `parent`'s window on a new side chat, starting it at once when there's a question. */
export function openSideChat(parent: SessionId, question: string): Promise<void> {
  if (question.trim() === "") {
    dispatch(parent, { kind: "open", shown: newQuestion("", null) });

    return Promise.resolve();
  }

  return startSideChat(parent, question.trim());
}

/** Shows the window's side chat, or the newest side chat, or a new one. */
export function summonSideChat(parent: SessionId): void {
  dispatch(parent, {
    kind: "summon",
    newest: sideChats(childList(parent).value ?? []).at(-1)?.id,
    blank: newQuestion("", null),
  });
}

export function showSideChat(parent: SessionId, id: SessionId): void {
  dispatch(parent, { kind: "open", shown: { kind: "chat", id } });
}

export function foldSideChat(parent: SessionId, folded: boolean): void {
  dispatch(parent, { kind: "fold", folded });
}

/**
 * Starts a side chat of `parent` with `question` as its first message, on `parent`'s model, and
 * shows it. The window shows the question while the host starts the chat, and the question again
 * with the reason when it can't. Once someone moves the window off the start, it stays where they
 * put it; the started chat is still listed among the side chats.
 */
export async function startSideChat(parent: SessionId, question: string): Promise<void> {
  const starting: SideChatShown = { kind: "starting", question };
  dispatch(parent, { kind: "open", shown: starting });
  const id = asId<"session">(crypto.randomUUID());
  const view = chatStore(parent).value;
  const choice = view === undefined ? undefined : projectSessionChoice(view, []);

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
      .next()
      .catch(() => undefined);
    dispatch(parent, { kind: "replace", from: starting, to: { kind: "chat", id } });
  } catch (cause: unknown) {
    dispatch(parent, {
      kind: "replace",
      from: starting,
      to: newQuestion(question, `Couldn't start the side chat: ${errorMessage(cause)}`),
    });
  }
}

/**
 * Archives side chat `id`, closing `parent`'s window when it showed it. When the host refuses and
 * the window is still closed, it opens again as it was, so the chat never looks archived when it
 * isn't.
 */
export async function archiveSideChat(parent: SessionId, id: SessionId): Promise<void> {
  const before = slotFor(parent).state;
  dispatch(parent, { kind: "archive", id });
  const closed = slotFor(parent).state === before ? undefined : before;

  try {
    await (await connected()).session(id).update({ archived: true });
  } catch {
    if (closed !== undefined) dispatch(parent, { kind: "restore", window: closed });
  }
}

/** The prompt layer a side chat starts with: what it is, and its parent's recent history. */
export function sideChatPrompt(messages: readonly Message[]): string {
  return `${FRAMING}\n\n<main_chat>\n${conversationText(messages, CONTEXT_CHARS)}\n</main_chat>`;
}

/** Side chat `session` as an excerpt for its parent's next message. */
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

/**
 * A conversation's newest `budget` characters as plain text: what each side said and the tools
 * the assistant used. It reads from the newest message back and stops once the budget is spent, so
 * a long chat costs only what it keeps. The newest line keeps its end when it alone is over the
 * budget; an older line that doesn't fit whole is left out.
 */
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

/** Moves `parent`'s window by `event`, waking its listeners only when the window changed. */
function dispatch(parent: SessionId, event: SideChatEvent): void {
  const slot = slotFor(parent);
  const next = nextSideChat(slot.state, event);

  if (next === slot.state) return;

  slot.state = next;
  slot.listeners.forEach((listener) => listener());
}

/** `parent`'s slot, made closed the first time its window is asked for. */
function slotFor(parent: SessionId): Slot {
  const known = slots.get(parent);

  if (known !== undefined) return known;
  const listeners = new Set<() => void>();

  const slot: Slot = {
    state: CLOSED,
    listeners,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };

  slots.set(parent, slot);

  return slot;
}
