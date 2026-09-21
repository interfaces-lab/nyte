/**
 * What `@` and `/` offer in the composer, and what accepting one writes.
 *
 * The trigger scan is core's `completionTrigger`, the same one the desktop
 * composer uses, so a token means the same thing on both clients. The choices
 * come from the host: files from `workspace.files`, commands and skills from
 * the session's plugins, or from the new-session catalog before a conversation
 * exists. Accepting writes the exact text the desktop writes, so a message sent
 * from a phone reads back there as the same chip.
 */
import { completionTrigger } from "@nyte-ai/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CompletionTrigger } from "@nyte-ai/client";
import type { CommandInfo, PluginCatalog, SessionId } from "@nyte-ai/protocol";
import type { NyteClient } from "@nyte-ai/client";
import { describeHostError } from "../connection/connection.ts";

/** A host read the menu shows as it goes: never an empty list standing in for a failure. */
type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly value: T };

/** Each choice carries what accepting it writes, so the writer needs no lookup. */
export type Suggestion =
  | { readonly kind: "file"; readonly url: string; readonly label: string; readonly detail: string }
  | { readonly kind: "command"; readonly name: string; readonly detail: string }
  | { readonly kind: "skill"; readonly name: string; readonly detail: string };

export interface Completion {
  readonly trigger: CompletionTrigger;
  readonly list: Loaded<readonly Suggestion[]>;
}

export interface Completions {
  /** The menu for the token under the caret, when the caret is in one. */
  readonly completion: Completion | undefined;
  /** Commands this conversation knows, once a `/` has asked the host for them. */
  readonly commands: readonly CommandInfo[];
}

/** Commands and skills come whole, so the phone caps what it lists from them. */
const MAX_SUGGESTIONS = 30;
/** Each keystroke inside an `@` token would otherwise be one host request. */
const FILE_DEBOUNCE_MS = 180;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("file search aborted", { cause: signal.reason }));
    });
  });
}

export function suggestionKey(suggestion: Suggestion): string {
  return suggestion.kind === "file" ? suggestion.url : `${suggestion.kind}:${suggestion.name}`;
}

export function suggestionLabel(suggestion: Suggestion): string {
  switch (suggestion.kind) {
    case "file":
      return suggestion.label;
    case "command":
      return `/${suggestion.name}`;
    case "skill":
      return suggestion.name;
    default: {
      const exhaustive: never = suggestion;
      return exhaustive;
    }
  }
}

export function suggestionIcon(suggestion: Suggestion): "doc" | "sparkles" | "book" {
  switch (suggestion.kind) {
    case "file":
      return "doc";
    case "command":
      return "sparkles";
    case "skill":
      return "book";
    default: {
      const exhaustive: never = suggestion;
      return exhaustive;
    }
  }
}

function matching(suggestions: readonly Suggestion[], query: string): readonly Suggestion[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return suggestions.slice(0, MAX_SUGGESTIONS);
  return suggestions
    .filter((suggestion) =>
      `${suggestionLabel(suggestion)} ${suggestion.detail}`.toLocaleLowerCase().includes(needle),
    )
    .slice(0, MAX_SUGGESTIONS);
}

function slashChoices(catalog: Pick<PluginCatalog, "commands" | "skills">): readonly Suggestion[] {
  return [
    ...catalog.commands.map((command): Suggestion => ({
      kind: "command",
      name: command.name,
      detail: command.description,
    })),
    ...catalog.skills.map((skill): Suggestion => ({
      kind: "skill",
      name: skill.name,
      detail: skill.description,
    })),
  ];
}

/**
 * The menu for the token under the caret. Commands and skills are read once per
 * conversation and workspace; files are read per query, because the host holds
 * the tree and narrows it rather than sending a repository to a phone.
 */
export function useCompletions(
  client: NyteClient,
  sessionId: SessionId | undefined,
  draft: string,
  caret: number,
  enabled: boolean,
  epoch: number,
): Completions {
  const trigger = enabled ? completionTrigger(draft, Math.min(caret, draft.length)) : undefined;
  const kind = trigger?.kind;
  const query = trigger?.query ?? "";
  // The keys carry the conversation and the workspace epoch, so an answer for
  // the previous chat or the previous folder can never appear as this one's.
  const slashQuery = useQuery({
    queryKey: ["slash-completion", sessionId ?? null, epoch],
    enabled: kind === "/",
    queryFn: async (): Promise<Pick<PluginCatalog, "commands" | "skills">> => {
      if (sessionId === undefined) return client.plugins.catalog();
      const [commands, skills] = await Promise.all([
        client.plugins.commands.list({ sessionId }),
        client.plugins.resources.list({ sessionId }),
      ]);
      return { commands, skills };
    },
  });
  const filesQuery = useQuery({
    queryKey: ["file-completion", sessionId ?? null, epoch, query],
    enabled: kind === "@",
    // The previous key's rows stay up while the debounced read lands, so a
    // keystroke narrows the menu instead of flashing the loading notice.
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<readonly Suggestion[]> => {
      // Reading `signal` marks the fetch cancelable: the next keystroke moves the
      // observer to a new key, the old query loses its last observer, and the
      // aborted delay ends before the request fires — debounce without a timer.
      await delay(FILE_DEBOUNCE_MS, signal);
      const found = await client.workspace.files({
        target: sessionId === undefined ? { kind: "workspace" } : { kind: "session", sessionId },
        query,
      });
      return found.map((file): Suggestion => ({
        kind: "file",
        url: file.url,
        label: file.label,
        detail: file.displayPath,
      }));
    },
  });

  const slash: Loaded<Pick<PluginCatalog, "commands" | "skills">> =
    slashQuery.status === "pending"
      ? { kind: "loading" }
      : slashQuery.status === "error"
        ? { kind: "failed", message: describeHostError(slashQuery.error) }
        : { kind: "ready", value: slashQuery.data };
  const files: Loaded<readonly Suggestion[]> =
    filesQuery.status === "pending"
      ? { kind: "loading" }
      : filesQuery.status === "error"
        ? { kind: "failed", message: describeHostError(filesQuery.error) }
        : { kind: "ready", value: filesQuery.data };

  const commands = slashQuery.data?.commands ?? [];
  if (trigger === undefined) return { completion: undefined, commands };
  if (trigger.kind === "@") return { commands, completion: { trigger, list: files } };
  return {
    commands,
    completion: {
      trigger,
      list:
        slash.kind === "ready"
          ? { kind: "ready", value: matching(slashChoices(slash.value), trigger.query) }
          : slash,
    },
  };
}

/** What the menu says instead of rows: loading, the host's refusal, or no match. */
export function suggestionNotice(completion: Completion): string | undefined {
  const files = completion.trigger.kind === "@";
  switch (completion.list.kind) {
    case "loading":
      return files ? "Looking for files…" : "Loading commands and skills…";
    case "failed":
      return completion.list.message;
    case "ready":
      return completion.list.value.length > 0
        ? undefined
        : files
          ? "No matching files"
          : "No matching commands or skills";
    default: {
      const exhaustive: never = completion.list;
      return exhaustive;
    }
  }
}

/** The sentence a skill travels as, identical to the desktop composer's. */
export function skillInstruction(name: string): string {
  return `Use the ${name} skill.`;
}

/**
 * Accepting a choice rewrites the token in place and says where the caret
 * belongs. A skill is the exception: it becomes the leading instruction the
 * host and the desktop both read as a skill, so it moves to the head.
 */
export function acceptSuggestion(
  draft: string,
  trigger: CompletionTrigger,
  suggestion: Suggestion,
): { draft: string; caret: number } {
  const before = draft.slice(0, trigger.start);
  const after = draft.slice(trigger.end);
  if (suggestion.kind === "skill") {
    const instruction = skillInstruction(suggestion.name);
    const body = `${before}${after}`;
    if (body.trimStart().startsWith(instruction))
      return { draft: body, caret: Math.min(before.length, body.length) };
    const head = `${instruction}\n\n`;
    return { draft: `${head}${body}`, caret: head.length + before.length };
  }
  const token = suggestion.kind === "command" ? `/${suggestion.name} ` : `@${suggestion.url} `;
  return { draft: `${before}${token}${after}`, caret: before.length + token.length };
}

/** A command the host can run, named by a whole draft. */
export interface CommandLine {
  readonly name: string;
  readonly argument: string;
}

/** A draft that is only a command line, the way the desktop composer reads one. */
export function parseCommandLine(
  draft: string,
  commands: readonly CommandInfo[],
): CommandLine | undefined {
  const input = draft.trim();
  if (!input.startsWith("/")) return undefined;
  const separator = input.search(/\s/u);
  const name = input.slice(1, separator === -1 ? undefined : separator);
  if (name === "" || !commands.some((command) => command.name === name)) return undefined;
  return { name, argument: separator === -1 ? "" : input.slice(separator).trimStart() };
}
