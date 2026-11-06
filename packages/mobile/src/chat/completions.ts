import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CommandInfo, Connection, SessionCatalogView, WorkspaceId } from "@nyte-ai/sdk";
import { describeHostError } from "../connection/connection.ts";
import { useHost } from "../connection/host-context.tsx";

export interface CompletionTrigger {
  readonly kind: "@" | "/";
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

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

type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "ready"; readonly value: T };

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
  readonly completion: Completion | undefined;
  readonly commands: readonly CommandInfo[];
}

export type CompletionSource =
  | {
      readonly kind: "session";
      readonly workspace: WorkspaceId | undefined;
      readonly catalog: SessionCatalogView;
    }
  | { readonly kind: "registered"; readonly id: WorkspaceId | undefined };

const MAX_SUGGESTIONS = 30;

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

export function useCompletions(
  client: Connection,
  source: CompletionSource,
  draft: string,
  caret: number,
  enabled: boolean,
  epoch: number,
): Completions {
  const { newerHost } = useHost();
  const trigger = enabled ? completionTrigger(draft, Math.min(caret, draft.length)) : undefined;
  const kind = trigger?.kind;
  const query = trigger?.query ?? "";
  const workspace = source.kind === "session" ? source.workspace : source.id;

  const filesQuery = useQuery({
    queryKey: ["file-completion", workspace ?? null, epoch, query],
    enabled: kind === "@" && workspace !== undefined,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }): Promise<readonly Suggestion[]> => {
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
          ? { kind: "failed", message: describeHostError(filesQuery.error, newerHost) }
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

function skillInstruction(name: string): string {
  return `Use the ${name} skill.`;
}

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

export interface CommandLine {
  readonly name: string;
  readonly argument: string;
}

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
