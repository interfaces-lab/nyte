/**
 * Slash, `@` mention and `/cd` completion as a pure state machine over the
 * draft mirror. Suggestions come from lib/slash.ts (`slashCompletion`,
 * `acceptSlashCommand`), the workspace's mention index (a fact the runner
 * keeps), directory listings (a `list-directory` effect) and a typed path
 * resolved against the filesystem (a `resolve-mention` effect).
 */
import fuzzysort from "fuzzysort";
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
      /** `@` only: what a query spelled as a path names on disk, null until resolved or when nothing. */
      readonly explicit: MentionFile | null;
    };

/** One file or folder an `@` mention can name. */
export interface MentionFile {
  /** Absolute path; folders end in `/`. */
  readonly path: string;
  /** Relative to the workspace, `/` suffix for folders. */
  readonly display: string;
  /** Basename, `/` suffix for folders. */
  readonly label: string;
}

export interface CompletionToken {
  readonly trigger: "/" | "@" | "cd";
  readonly query: string;
  readonly from: number;
  readonly to: number;
}

export interface CompletionModel {
  readonly token: CompletionToken;
  /** Empty while `loading`, or when nothing matches: the menu says so and only Esc acts on it. */
  readonly items: readonly CompletionItem[];
  /** `/cd` only: the listing for the typed path has not arrived. */
  readonly loading: boolean;
  readonly highlighted: number;
  /** Enter belongs to the menu (false for `/cd`, where Enter runs the typed path, and for an empty menu). */
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
  /** The workspace's files and folders for `@`; null until indexed. */
  readonly files: readonly MentionFile[] | null;
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

/** A query spelled as a path (`./x`, `../x`, `~/x`, `/x`, `C:\x`) the runner resolves on disk. */
const EXPLICIT_PATH = /^(?:\.{1,2}[/\\]|~[/\\]|[/\\]|[A-Za-z]:[/\\])/u;

export function explicitMentionQuery(query: string): boolean {
  return EXPLICIT_PATH.test(query);
}

/** An index entry (workspace-relative, `/` suffix for folders) as a mention under `cwd`. */
export function indexedMention(cwd: string, entry: string): MentionFile {
  return { path: `${cwd.replace(/\/+$/u, "")}/${entry}`, display: entry, label: baseName(entry) };
}

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
      : { kind: "open", token, highlighted: 0, directories: null, explicit: null };

  if (tokenKey(state.token) === tokenKey(token) && state.token.query === token.query)
    return { ...state, token };

  return { kind: "open", token, highlighted: 0, directories: null, explicit: null };
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

/** Prefix matches on the name or path first, then fuzzysort over both; the first ten when the query is empty. */
export function mentionSuggestions(
  query: string,
  files: readonly MentionFile[],
): readonly MentionFile[] {
  if (query === "") return files.slice(0, MAX_MENTIONS);
  const needle = query.toLowerCase();
  const prefixed: MentionFile[] = [];

  for (const file of files) {
    if (prefixed.length >= MAX_MENTIONS) break;

    if (
      file.label.toLowerCase().startsWith(needle) ||
      file.display.toLowerCase().startsWith(needle)
    )
      prefixed.push(file);
  }

  if (prefixed.length === MAX_MENTIONS) return prefixed;
  const seen = new Set(prefixed.map((file) => file.path));

  const fuzzy = fuzzysort
    .go(query, files, { keys: ["display", "label"], limit: MAX_MENTIONS })
    .flatMap((result) => (seen.has(result.obj.path) ? [] : [result.obj]));

  return [...prefixed, ...fuzzy].slice(0, MAX_MENTIONS);
}

/** The typed path first when it names something the list lacks, then the ranked index (none until indexed). */
function mentionItems(
  query: string,
  explicit: MentionFile | null,
  files: readonly MentionFile[] | null,
): readonly MentionFile[] {
  const ranked = files === null ? [] : mentionSuggestions(query, files);

  if (explicit === null || ranked.some((file) => file.path === explicit.path)) return ranked;

  return [explicit, ...ranked];
}

/** The menu's rows, "loading" while a `/cd` listing is out, or null for no menu (a mid-prompt slash nothing matches is a path). */
function itemsFor(
  state: Extract<CompletionState, { kind: "open" }>,
  draft: Pick<Draft, "text" | "cursor">,
  sources: CompletionSources,
): readonly CompletionItem[] | "loading" | null {
  switch (state.token.trigger) {
    case "/": {
      const slash = slashCompletion(draft.text, sources.commands, draft.cursor);

      if (slash === undefined || (slash.commands.length === 0 && !slash.leading)) return null;

      return slash.commands.map((command) => ({
        id: command.name,
        label: slashCommandLabel(command),
        detail: command.description,
        kind: slashKind(command),
      }));
    }

    case "@":
      return mentionItems(state.token.query, state.explicit, sources.files).map((file) => ({
        id: file.path,
        label: file.label,
        detail: file.display,
        kind: file.path.endsWith("/") ? "directory" : "file",
      }));
    case "cd":
      return state.directories === null
        ? "loading"
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
  const found = itemsFor(state, draft, sources);

  if (found === null) return null;
  const items = found === "loading" ? [] : found;
  const highlighted = Math.max(0, Math.min(items.length - 1, state.highlighted));

  return {
    token: state.token,
    items,
    loading: found === "loading",
    highlighted,
    ownsEnter: state.token.trigger !== "cd" && items.length > 0,
    queueable: items[highlighted]?.kind === "skill",
  };
}

/** Moves the highlight with wrap-around (or by a page, clamped). */
export function moveCompletion(
  state: CompletionState,
  model: CompletionModel,
  by: -1 | 1 | "page-up" | "page-down",
): CompletionState {
  const count = model.items.length;

  if (state.kind !== "open" || count === 0) return state;
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
): CompletionEdit | null {
  const { from, to } = model.token;

  if (model.token.trigger === "@")
    return { kind: "file", from, to, path: item.id, directory: item.id.endsWith("/") };

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
