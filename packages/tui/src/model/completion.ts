/**
 * Slash, `@` mention and `/cd` completion as a pure state machine over the
 * draft mirror. Suggestions come from lib/slash.ts (`slashCompletion`,
 * `acceptSlashCommand`), the workspace's mention index (a fact the runner
 * keeps) and directory listings (a `list-directory` effect).
 */
import { directoryCompletionQuery } from "../lib/directory-completion.ts";
import { acceptSlashCommand, slashCommandLabel, slashCompletion } from "../lib/slash.ts";
import type { SlashCommand } from "../lib/slash.ts";
import { completionTrigger } from "../lib/view-helpers.ts";
import type { Draft } from "./state.ts";

export type CompletionState =
  | { readonly kind: "closed"; readonly dismissed: string | null }
  | {
      readonly kind: "open";
      readonly token: CompletionToken;
      readonly highlighted: number;
      /** `/cd` only: the listing for `token.query`, null while the runner lists it. */
      readonly directories: { readonly path: string; readonly entries: readonly string[] } | null;
    };

export interface CompletionToken {
  readonly trigger: "/" | "@" | "cd";
  readonly query: string;
  readonly from: number;
  readonly to: number;
}

export interface CompletionModel {
  readonly token: CompletionToken;
  readonly items: readonly CompletionItem[];
  readonly highlighted: number;
  /** Enter belongs to the menu (false for `/cd`, where Enter runs the typed path). */
  readonly ownsEnter: boolean;
  /** Ctrl+Enter on a highlighted skill fills the token, then submits with the alternate delivery. */
  readonly queueable: boolean;
}

export interface CompletionItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly kind: "action" | "setting" | "skill" | "plugin" | "file" | "directory";
}

export interface CompletionSources {
  /** The slash namespace in claim order (`availableSlashCommands`). */
  readonly commands: readonly SlashCommand[];
  /** Workspace-relative paths for `@`, directories with a `/` suffix; null until indexed. */
  readonly files: readonly string[] | null;
}

/** What accepting an item does to the draft. */
export type CompletionEdit =
  | { readonly kind: "replace"; readonly from: number; readonly to: number; readonly text: string }
  | {
      readonly kind: "execute";
      readonly name: string;
      /** The draft is the command line: clear it. Otherwise remove the token and one adjacent space. */
      readonly leading: boolean;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: "file";
      readonly from: number;
      readonly to: number;
      readonly path: string;
      readonly directory: boolean;
    };

const MAX_MENTIONS = 10;

export const CLOSED: CompletionState = { kind: "closed", dismissed: null };

function tokenKey(token: CompletionToken): string {
  return `${token.trigger}:${String(token.from)}`;
}

/** The token under the cursor: a `/cd` path first, then a `/` or `@` word. */
export function completionToken(draft: Pick<Draft, "text" | "cursor">): CompletionToken | null {
  const directory = directoryCompletionQuery(draft.text, draft.cursor);

  if (directory !== undefined)
    return { trigger: "cd", query: directory.path, from: directory.start, to: directory.end };
  const trigger = completionTrigger(draft.text, draft.cursor);

  if (trigger === undefined) return null;

  return { trigger: trigger.kind, query: trigger.query, from: trigger.start, to: trigger.end };
}

/** Re-derives the token from the mirror; Esc's `dismissed` sticks until that token disappears. Closed while the draft starts with `!`. */
export function nextCompletion(
  state: CompletionState,
  draft: Pick<Draft, "text" | "cursor">,
): CompletionState {
  if (draft.text.startsWith("!")) return CLOSED;
  const token = completionToken(draft);

  if (token === null) return CLOSED;

  if (state.kind === "closed")
    return state.dismissed === tokenKey(token)
      ? state
      : { kind: "open", token, highlighted: 0, directories: null };

  if (tokenKey(state.token) === tokenKey(token) && state.token.query === token.query)
    return { ...state, token };

  return { kind: "open", token, highlighted: 0, directories: null };
}

/** Esc: closed until the token under the cursor goes away. */
export function dismissCompletion(state: CompletionState): CompletionState {
  return state.kind === "open" ? { kind: "closed", dismissed: tokenKey(state.token) } : state;
}

function slashKind(command: SlashCommand): CompletionItem["kind"] {
  if (command.kind === "prompt") return "skill";

  return command.kind === "setting" ? "setting" : "action";
}

function baseName(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const name = trimmed.split("/").at(-1) ?? trimmed;

  return path.endsWith("/") ? `${name}/` : name;
}

function subsequence(needle: string, haystack: string): boolean {
  let at = 0;

  for (const character of haystack) {
    if (character === needle[at]) at += 1;

    if (at === needle.length) return true;
  }

  return needle.length === 0;
}

/** Prefix matches on the name or path first, then the rest whose letters appear in order. */
export function mentionSuggestions(query: string, files: readonly string[]): readonly string[] {
  if (query === "") return files.slice(0, MAX_MENTIONS);
  const needle = query.toLowerCase();

  const prefixed = files.filter(
    (file) =>
      baseName(file).toLowerCase().startsWith(needle) || file.toLowerCase().startsWith(needle),
  );

  if (prefixed.length >= MAX_MENTIONS) return prefixed.slice(0, MAX_MENTIONS);
  const seen = new Set(prefixed);
  const loose = files.filter((file) => !seen.has(file) && subsequence(needle, file.toLowerCase()));

  return [...prefixed, ...loose].slice(0, MAX_MENTIONS);
}

function itemsFor(
  state: Extract<CompletionState, { kind: "open" }>,
  draft: Pick<Draft, "text" | "cursor">,
  sources: CompletionSources,
): readonly CompletionItem[] | null {
  switch (state.token.trigger) {
    case "/": {
      const slash = slashCompletion(draft.text, sources.commands, draft.cursor);

      if (slash === undefined || slash.commands.length === 0) return null;

      return slash.commands.map((command) => ({
        id: command.name,
        label: slashCommandLabel(command),
        detail: command.description,
        kind: slashKind(command),
      }));
    }

    case "@":
      return sources.files === null
        ? null
        : mentionSuggestions(state.token.query, sources.files).map((file) => ({
            id: file,
            label: baseName(file),
            detail: file,
            kind: file.endsWith("/") ? "directory" : "file",
          }));
    case "cd":
      return state.directories === null
        ? null
        : state.directories.entries.map((entry) => ({
            id: entry,
            label: entry,
            detail: "",
            kind: "directory",
          }));
    default: {
      const _exhaustive: never = state.token.trigger;

      return _exhaustive;
    }
  }
}

export function completionModel(
  state: CompletionState,
  draft: Pick<Draft, "text" | "cursor">,
  sources: CompletionSources,
): CompletionModel | null {
  if (state.kind === "closed") return null;
  const items = itemsFor(state, draft, sources);

  if (items === null || items.length === 0) return null;
  const highlighted = Math.max(0, Math.min(items.length - 1, state.highlighted));

  return {
    token: state.token,
    items,
    highlighted,
    ownsEnter: state.token.trigger !== "cd",
    queueable: items[highlighted]?.kind === "skill",
  };
}

/** Moves the highlight with wrap-around (or by a page, clamped). */
export function moveCompletion(
  state: CompletionState,
  model: CompletionModel,
  by: -1 | 1 | "page-up" | "page-down",
): CompletionState {
  if (state.kind !== "open") return state;
  const count = model.items.length;
  const page = Math.max(1, Math.min(count, MAX_MENTIONS) - 1);

  const highlighted =
    by === "page-up"
      ? Math.max(0, model.highlighted - page)
      : by === "page-down"
        ? Math.min(count - 1, model.highlighted + page)
        : (model.highlighted + by + count) % count;

  return { ...state, highlighted };
}

/**
 * What accepting `item` does, by the old SlashAutocomplete rules: a file
 * becomes its marker, a directory completes the `/cd` path, `/cd` completes
 * itself, and a command runs or completes per `acceptSlashCommand` (a
 * token followed by text only completes).
 */
export function completionEdit(
  model: CompletionModel,
  item: CompletionItem,
  draft: Pick<Draft, "text">,
  via: "return" | "tab",
  sources: CompletionSources,
  cwd: string,
): CompletionEdit | null {
  const { from, to } = model.token;

  if (model.token.trigger === "@")
    return {
      kind: "file",
      from,
      to,
      path: `${cwd.replace(/\/+$/u, "")}/${item.id}`,
      directory: item.id.endsWith("/"),
    };

  if (model.token.trigger === "cd") return { kind: "replace", from, to, text: item.id };
  const command = sources.commands.find((candidate) => candidate.name === item.id);

  if (command === undefined) return null;

  if (command.name === "cd") return { kind: "replace", from, to, text: "/cd " };
  const leading = draft.text.slice(0, from).trim() === "";
  const acceptance = acceptSlashCommand(command, via, leading ? draft.text.slice(to).trim() : "");

  if (acceptance.action === "complete")
    return { kind: "replace", from, to, text: acceptance.token };

  return { kind: "execute", name: command.name, leading, from, to };
}

/** Replaces `[from, to)` with `insert`, dropping a trailing space the tail already supplies. */
export function splice(text: string, from: number, to: number, insert: string) {
  const tail = text.slice(to);
  const inserted = insert.endsWith(" ") && /^\s/u.test(tail) ? insert.slice(0, -1) : insert;

  return {
    text: `${text.slice(0, from)}${inserted}${tail}`,
    cursor: from + inserted.length,
    inserted,
  };
}

/** The range an inline action removes: its token plus one adjacent space or tab. */
export function inlineTokenRange(text: string, from: number, to: number) {
  if (/^[ \t]$/u.test(text[to] ?? "")) return { from, to: to + 1 };

  if (/^[ \t]$/u.test(text[from - 1] ?? "")) return { from: from - 1, to };

  return { from, to };
}
