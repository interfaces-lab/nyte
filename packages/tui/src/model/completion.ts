import fuzzysort from "fuzzysort";
import { completionTrigger } from "@nyte-ai/plugin/client/presentation";
import { directoryCompletionQuery } from "../lib/directory-completion.ts";
import { acceptSlashCommand, slashCommandLabel, slashCompletion } from "../lib/slash.ts";
import type { SlashCommand } from "../lib/slash.ts";
import type { Draft } from "./state.ts";

export type CompletionState =
  | { readonly kind: "closed"; readonly dismissed: string | null }
  | {
      readonly kind: "open";
      readonly token: CompletionToken;
      readonly highlighted: number;
      readonly directories: { readonly path: string; readonly entries: readonly string[] } | null;
      readonly explicit: MentionFile | null;
    };

export interface MentionFile {
  readonly path: string;
  readonly display: string;
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
  readonly items: readonly CompletionItem[];
  readonly loading: boolean;
  readonly highlighted: number;
  readonly ownsEnter: boolean;
  readonly queueable: boolean;
}

export interface CompletionItem {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly kind: "action" | "setting" | "skill" | "plugin" | "file" | "directory";
}

interface CompletionSources {
  readonly commands: readonly SlashCommand[];
  readonly files: readonly MentionFile[] | null;
}

type CompletionEdit =
  | { readonly kind: "replace"; readonly from: number; readonly to: number; readonly text: string }
  | {
      readonly kind: "execute";
      readonly name: string;
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

const EXPLICIT_PATH = /^(?:\.{1,2}[/\\]|~[/\\]|[/\\]|[A-Za-z]:[/\\])/u;

export function explicitMentionQuery(query: string): boolean {
  return EXPLICIT_PATH.test(query);
}

export function indexedMention(cwd: string, entry: string): MentionFile {
  return { path: `${cwd.replace(/\/+$/u, "")}/${entry}`, display: entry, label: baseName(entry) };
}

export const CLOSED: CompletionState = { kind: "closed", dismissed: null };

function tokenKey(token: CompletionToken): string {
  return `${token.trigger}:${String(token.from)}`;
}

export function completionToken(draft: Pick<Draft, "text" | "cursor">): CompletionToken | null {
  const directory = directoryCompletionQuery(draft.text, draft.cursor);

  if (directory !== undefined)
    return { trigger: "cd", query: directory.path, from: directory.start, to: directory.end };
  const trigger = completionTrigger(draft.text, draft.cursor);

  if (trigger === undefined) return null;

  return { trigger: trigger.kind, query: trigger.query, from: trigger.start, to: trigger.end };
}

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

function mentionItems(
  query: string,
  explicit: MentionFile | null,
  files: readonly MentionFile[] | null,
): readonly MentionFile[] {
  const ranked = files === null ? [] : mentionSuggestions(query, files);

  if (explicit === null || ranked.some((file) => file.path === explicit.path)) return ranked;

  return [explicit, ...ranked];
}

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

export function splice(text: string, from: number, to: number, insert: string) {
  const tail = text.slice(to);
  const inserted = insert.endsWith(" ") && /^\s/u.test(tail) ? insert.slice(0, -1) : insert;

  return {
    text: `${text.slice(0, from)}${inserted}${tail}`,
    cursor: from + inserted.length,
    inserted,
  };
}

export function inlineTokenRange(text: string, from: number, to: number) {
  if (/^[ \t]$/u.test(text[to] ?? "")) return { from, to: to + 1 };

  if (/^[ \t]$/u.test(text[from - 1] ?? "")) return { from: from - 1, to };

  return { from, to };
}
