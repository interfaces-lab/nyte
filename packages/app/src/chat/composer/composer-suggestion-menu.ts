import { completionTrigger, findCommandArgument } from "@nyte-ai/plugin/client/presentation";
import type { CommandInfo, SkillInfo } from "@nyte-ai/sdk";
import type { ComposerDocumentState } from "./composer-document.ts";
import { composerEnterAction } from "./composer-keys.ts";
import type {
  createMentionSuggestionRanking,
  FileSuggestion,
  MentionSuggestion,
} from "./composer-suggestion-ranking.ts";
import { CONVERSATION_MENTION } from "../../references/message-references.ts";
import type { MessageReference } from "../../references/message-references.ts";

interface SkillSuggestion {
  readonly kind: "skill";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "skills";
  readonly skill: SkillInfo;
}

interface PluginCommandSuggestion {
  readonly kind: "plugin-command";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "command";
  readonly command: CommandInfo;
}

export interface ArgumentSuggestion {
  readonly kind: "argument";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "command";
  readonly value: string;
}

export type ComposerSuggestion =
  | ArgumentSuggestion
  | PluginCommandSuggestion
  | SkillSuggestion
  | MentionSuggestion
  | FileSuggestion;

export type ChipSuggestion = Exclude<
  ComposerSuggestion,
  PluginCommandSuggestion | ArgumentSuggestion
>;

export type SuggestionToken =
  | {
      readonly kind: "mention";
      readonly start: number;
      readonly end: number;
      readonly query: string;
    }
  | {
      readonly kind: "slash";
      readonly start: number;
      readonly end: number;
      readonly query: string;
    }
  | {
      readonly kind: "argument";
      readonly command: string;
      readonly start: number;
      readonly end: number;
      readonly query: string;
    };

export function argumentToken(
  document: ComposerDocumentState,
  commands: readonly CommandInfo[],
): SuggestionToken | undefined {
  const argument = findCommandArgument(document.text, document.selectionStart);

  if (
    argument === undefined ||
    document.selectionStart !== document.selectionEnd ||
    !commands.some((candidate) => candidate.name === argument.command && candidate.completes)
  )
    return undefined;

  return { kind: "argument", ...argument, end: document.text.length };
}

export function liveToken(
  document: ComposerDocumentState,
  menu: SuggestionToken,
  commands: readonly CommandInfo[],
): SuggestionToken | undefined {
  if (menu.kind === "argument") {
    const argument = argumentToken(document, commands);

    return argument?.kind === "argument" &&
      argument.command === menu.command &&
      argument.start === menu.start
      ? argument
      : undefined;
  }

  const token = completionTrigger(
    document.text.slice(menu.start),
    document.selectionStart - menu.start,
  );

  if (
    token?.start !== 0 ||
    document.selectionStart !== document.selectionEnd ||
    token.kind !== (menu.kind === "mention" ? "@" : "/") ||
    (token.kind === "@" && token.query.startsWith("file://"))
  )
    return undefined;

  return { kind: menu.kind, start: menu.start, end: menu.start + token.end, query: token.query };
}

export type ComposerSource<T> =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly data: T };

const NYTE_COMMAND_OWNERS = new Set(["", "rename", "web"]);

interface RankedSuggestion {
  readonly suggestion: ComposerSuggestion;
  readonly index: number;
  readonly rank: number;
}

function rankSuggestions(
  suggestions: readonly ComposerSuggestion[],
  query: string,
): readonly ComposerSuggestion[] {
  if (query === "") return suggestions;

  return suggestions
    .flatMap((suggestion, index): RankedSuggestion[] => {
      const label = suggestion.label.toLocaleLowerCase();
      const description = suggestion.description.toLocaleLowerCase();

      const rank = label.startsWith(query)
        ? 0
        : label.includes(query)
          ? 1
          : description.includes(query)
            ? 2
            : undefined;

      return rank === undefined ? [] : [{ suggestion, index, rank }];
    })
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ suggestion }) => suggestion);
}

export function suggestionsFor(
  kind: Exclude<SuggestionToken["kind"], "argument">,
  rawQuery: string,
  commands: readonly CommandInfo[],
  skills: readonly SkillInfo[],
  rankMentions: ReturnType<typeof createMentionSuggestionRanking>,
  hasConversationContext: boolean,
): readonly ComposerSuggestion[] {
  if (kind === "mention") {
    return rankMentions(rawQuery, hasConversationContext);
  }

  const query = rawQuery.trim().toLocaleLowerCase();

  return rankSuggestions(
    [
      ...commands.map((command): ComposerSuggestion => ({
        kind: "plugin-command",
        id: `plugin-command:${command.name}`,
        label: command.name,
        description: command.description,
        icon: "command",
        command,
      })),
      ...skills.map((skill): ComposerSuggestion => ({
        kind: "skill",
        id: `skill:${skill.name}`,
        label: skill.name,
        description: skill.description,
        icon: "skills",
        skill,
      })),
    ],
    query,
  );
}

type SuggestionGroup = "context" | "files" | "commands" | "skills";

export function suggestionGroup(suggestion: ComposerSuggestion): SuggestionGroup {
  switch (suggestion.kind) {
    case "mention":
      return "context";
    case "file":
      return "files";
    case "plugin-command":
    case "argument":
      return "commands";
    case "skill":
      return "skills";
    default: {
      const _exhaustive: never = suggestion;

      return _exhaustive;
    }
  }
}

export function suggestionPreviewTitle(suggestion: ComposerSuggestion): string {
  if (suggestion.kind !== "skill") return suggestion.label;

  return suggestion.label
    .split(/[-_]/u)
    .filter((part) => part !== "")
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function suggestionAttribution(suggestion: ComposerSuggestion): string | undefined {
  switch (suggestion.kind) {
    case "plugin-command":
      return NYTE_COMMAND_OWNERS.has(suggestion.command.owner)
        ? "Created by Nyte"
        : `Created by ${suggestion.command.owner}`;
    case "skill":
      return suggestion.skill.location;
    case "mention":
    case "argument":
    case "file":
      return undefined;
    default: {
      const _exhaustive: never = suggestion;

      return _exhaustive;
    }
  }
}

export function suggestionEmptyText(
  kind: Exclude<SuggestionToken["kind"], "argument">,
  source: ComposerSource<unknown>,
  slashSubject: "commands and skills" | "skills",
): string {
  switch (source.status) {
    case "loading":
      return kind === "mention" ? "Loading files…" : `Loading ${slashSubject}…`;
    case "error":
      return kind === "mention" ? "Couldn’t load workspace files" : `Couldn’t load ${slashSubject}`;
    case "ready":
      return kind === "mention" ? "No Context Found" : "No matches";
    default: {
      const _exhaustive: never = source;

      return _exhaustive;
    }
  }
}

export function findQuery(
  text: string,
  query: string,
): { readonly start: number; readonly end: number } | undefined {
  const needle = query.trim().toLocaleLowerCase();

  if (needle === "") return undefined;
  const [before = "", ...after] = text.toLocaleLowerCase().split(needle);

  if (after.length === 0) return undefined;

  return { start: before.length, end: before.length + needle.length };
}

export function descriptionExcerpt(description: string, query: string): string {
  const match = findQuery(description, query);

  if (match === undefined || match.start <= 36) return description;
  const start = Math.max(0, match.start - 24);

  return `${start === 0 ? "" : "…"}${description.slice(start)}`;
}

export function suggestionReference(suggestion: ChipSuggestion): MessageReference {
  switch (suggestion.kind) {
    case "skill":
      return { kind: "skill", name: suggestion.skill.name, path: suggestion.skill.location };
    case "mention":
      return CONVERSATION_MENTION;
    case "file":
      return { kind: "file", file: suggestion.file };
    default: {
      const exhaustive: never = suggestion;

      return exhaustive;
    }
  }
}

export interface MenuState {
  readonly token: SuggestionToken | undefined;
  readonly index: number;
  readonly highlighted: boolean;
}

export const CLOSED_MENU: MenuState = { token: undefined, index: 0, highlighted: false };

export type MenuEvent =
  | { readonly kind: "token"; readonly token: SuggestionToken | undefined }
  | { readonly kind: "move"; readonly to: number; readonly count: number }
  | { readonly kind: "point"; readonly index: number; readonly count: number };

export function nextMenu(menu: MenuState, event: MenuEvent): MenuState {
  switch (event.kind) {
    case "token":
      return menu.token !== undefined &&
        event.token !== undefined &&
        menu.token.kind === event.token.kind &&
        menu.token.start === event.token.start
        ? { ...menu, token: event.token }
        : unchanged(menu, { token: event.token, index: 0, highlighted: false });
    case "move":
      if (event.count === 0) return menu;

      return unchanged(menu, {
        token: menu.token,
        index: Math.max(0, Math.min(event.count - 1, event.to)),
        highlighted: true,
      });
    case "point":
      return unchanged(menu, {
        token: menu.token,
        index:
          Math.min(menu.index, Math.max(0, event.count - 1)) === event.index
            ? menu.index
            : event.index,
        highlighted: true,
      });
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

export type MenuKey =
  | { readonly kind: "move"; readonly to: number }
  | { readonly kind: "pick" }
  | { readonly kind: "close" }
  | { readonly kind: "pass" };

export function menuKey(
  key: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "metaKey" | "isComposing">,
  active: number,
  count: number,
): MenuKey {
  if (key.key === "Escape") return { kind: "close" };

  const down = key.key === "ArrowDown" || (key.ctrlKey && (key.key === "n" || key.key === "j"));
  const up = key.key === "ArrowUp" || (key.ctrlKey && (key.key === "p" || key.key === "k"));

  if (down || up) return { kind: "move", to: active + (down ? 1 : -1) };

  if (key.key === "Home" || key.key === "End")
    return { kind: "move", to: key.key === "Home" ? 0 : count - 1 };

  if (key.key === "PageDown" || key.key === "PageUp")
    return { kind: "move", to: active + (key.key === "PageDown" ? 9 : -9) };

  if (composerEnterAction(key) === "submit" || (key.key === "Tab" && !key.shiftKey))
    return { kind: "pick" };

  return { kind: "pass" };
}

export function pickFor(
  token: SuggestionToken,
  deferredQuery: string,
  shown: readonly ComposerSuggestion[],
  live: () => readonly ComposerSuggestion[],
  index: number,
): ComposerSuggestion | undefined {
  return token.query === deferredQuery ? shown[index] : live()[0];
}

function unchanged(menu: MenuState, next: MenuState): MenuState {
  return menu.token === next.token &&
    menu.index === next.index &&
    menu.highlighted === next.highlighted
    ? menu
    : next;
}
