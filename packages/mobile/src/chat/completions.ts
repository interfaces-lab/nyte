/**
 * What `@` and `/` offer in the composer, and what accepting one writes.
 *
 * The choices come from the host: files from the workspace's `files.find`,
 * commands and skills from the session view's catalog. A chat starts with its
 * first message, so a new chat offers no commands or skills, and files from
 * the folder chosen here.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CommandInfo, Connection, SessionCatalogView, WorkspaceId } from "@nyte-ai/sdk";
import { describeHostError } from "../connection/connection.ts";

/** The inline composer token being completed: its trigger, its span, and the text typed after the trigger. */
export interface CompletionTrigger {
  readonly kind: "@" | "/";
  /** Full token span. Accepting a result replaces this range. */
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

/**
 * Returns the @ or / token under the caret. Mid-word trigger characters are
 * text, while the replacement range extends through the token's whole tail.
 */
function completionTrigger(value: string, cursor: number): CompletionTrigger | undefined {
  const caret = Math.max(0, Math.min(cursor, value.length));
  let start = caret;

  while (start > 0 && (value[start - 1] ?? "").trim() !== "") start -= 1;
  const kind = value[start];

  if (start === caret || (kind !== "@" && kind !== "/")) return undefined;
  let end = caret;

  while (end < value.length && (value[end] ?? "").trim() !== "") end += 1;

  return { kind, start, end, query: value.slice(start + 1, caret) };
}

/** A host read the menu shows as it goes: never an empty list standing in for a failure. */
type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly value: T };

/** Each choice carries what accepting it writes, so the writer needs no lookup. */
export type Suggestion =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly label: string;
      readonly detail: string;
    }
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

/**
 * Where a composer's `@` and `/` look: a conversation's folder and the
 * catalog its view carries, or a new chat with the folder this phone chose,
 * if any.
 */
export type CompletionSource =
  | {
      readonly kind: "session";
      readonly workspace: WorkspaceId | undefined;
      readonly catalog: SessionCatalogView;
    }
  | { readonly kind: "registered"; readonly id: WorkspaceId | undefined };

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
  return suggestion.kind === "file" ? suggestion.path : `${suggestion.kind}:${suggestion.name}`;
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

function matching(suggestions: readonly Suggestion[], query: string): readonly Suggestion[] {
  const needle = query.trim().toLocaleLowerCase();

  if (needle === "") return suggestions.slice(0, MAX_SUGGESTIONS);

  return suggestions
    .filter((suggestion) =>
      `${suggestionLabel(suggestion)} ${suggestion.detail}`.toLocaleLowerCase().includes(needle),
    )
    .slice(0, MAX_SUGGESTIONS);
}

function slashChoices(
  catalog: Pick<SessionCatalogView, "commands" | "skills">,
): readonly Suggestion[] {
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
 * The menu for the token under the caret. Commands and skills are the session
 * view's catalog; files are read per query, because the host holds the tree and
 * narrows it rather than sending a repository to a phone.
 */
export function useCompletions(
  client: Connection,
  source: CompletionSource,
  draft: string,
  caret: number,
  enabled: boolean,
  epoch: number,
): Completions {
  const trigger = enabled ? completionTrigger(draft, Math.min(caret, draft.length)) : undefined;
  const kind = trigger?.kind;
  const query = trigger?.query ?? "";
  const workspace = source.kind === "session" ? source.workspace : source.id;

  const filesQuery = useQuery({
    queryKey: ["file-completion", workspace ?? null, epoch, query],
    enabled: kind === "@" && workspace !== undefined,
    // The previous key's rows stay up while the debounced read lands, so a
    // keystroke narrows the menu instead of flashing the loading notice.
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<readonly Suggestion[]> => {
      // Reading `signal` marks the fetch cancelable: the next keystroke moves the
      // observer to a new key, the old query loses its last observer, and the
      // aborted delay ends before the request fires — debounce without a timer.
      await delay(FILE_DEBOUNCE_MS, signal);

      if (workspace === undefined) return [];
      const files = await client.workspace(workspace).files();

      if (files.kind !== "available") throw new Error(files.reason);
      const found = await files.api.find({ query, limit: MAX_SUGGESTIONS });

      return found.map((file): Suggestion => {
        const slash = file.path.lastIndexOf("/");

        return {
          kind: "file",
          path: file.path,
          label: slash < 0 ? file.path : file.path.slice(slash + 1),
          detail: file.path,
        };
      });
    },
  });

  const catalog = source.kind === "session" ? source.catalog : undefined;

  const files: Loaded<readonly Suggestion[]> =
    workspace === undefined
      ? { kind: "failed", message: "Choose a folder to mention its files." }
      : filesQuery.status === "pending"
        ? { kind: "loading" }
        : filesQuery.status === "error"
          ? { kind: "failed", message: describeHostError(filesQuery.error) }
          : { kind: "ready", value: filesQuery.data };

  const commands = catalog?.commands ?? [];

  if (trigger === undefined) return { completion: undefined, commands };

  if (trigger.kind === "@") return { commands, completion: { trigger, list: files } };

  return {
    commands,
    completion: {
      trigger,
      list: {
        kind: "ready",
        value: matching(slashChoices(catalog ?? { commands: [], skills: [] }), trigger.query),
      },
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
) {
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

  const token = suggestion.kind === "command" ? `/${suggestion.name} ` : `@${suggestion.path} `;

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
