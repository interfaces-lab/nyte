import { completionTrigger, findCommandArgument } from "@nyte-ai/plugin/client/presentation";
import type { CommandInfo, SkillInfo } from "@nyte-ai/sdk";
import type { ComposerDocumentState } from "./composer-document.ts";
import { composerEnterAction } from "./composer-keys.ts";
import type { SuggestionFrecency } from "./composer-recent.ts";
import { fuzzyMatch } from "./composer-suggestion-ranking.ts";
import type {
  FileSuggestion,
  MentionRanking,
  MentionRecency,
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
  readonly recent?: true;
}

interface PluginCommandSuggestion {
  readonly kind: "plugin-command";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: "command";
  readonly command: CommandInfo;
  readonly recent?: true;
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

  const opener = menu.kind === "mention" && document.text[menu.start - 1] === "(" ? 1 : 0;
  const from = menu.start - opener;
  const token = completionTrigger(document.text.slice(from), document.selectionStart - from);

  if (
    token?.start !== opener ||
    document.selectionStart !== document.selectionEnd ||
    token.kind !== (menu.kind === "mention" ? "@" : "/") ||
    (token.kind === "@" && token.query.startsWith("file://"))
  )
    return undefined;

  return { kind: menu.kind, start: menu.start, end: from + token.end, query: token.query };
}

export type ComposerSource<T> =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly data: T };

const NYTE_COMMAND_OWNERS = new Set(["", "rename", "web"]);

type SlashSuggestion = PluginCommandSuggestion | SkillSuggestion;

interface RankedSuggestion {
  readonly suggestion: SlashSuggestion;
  readonly order: number;
  readonly tier: number;
  readonly weight: number;
}

function slashTier(query: string, label: string, description: string): number | undefined {
  if (query === "" || label === query) return 0;

  if (label.startsWith(query)) return 1;

  if (label.includes(query)) return 2;

  if (fuzzyMatch(query, label)) return 3;

  return description.includes(query) ? 4 : undefined;
}

function rankSuggestions(
  suggestions: readonly SlashSuggestion[],
  query: string,
  frecency: SuggestionFrecency,
): readonly ComposerSuggestion[] {
  return suggestions
    .flatMap((suggestion, order): RankedSuggestion[] => {
      const tier = slashTier(
        query,
        suggestion.label.toLocaleLowerCase(),
        suggestion.description.toLocaleLowerCase(),
      );

      return tier === undefined
        ? []
        : [{ suggestion, order, tier, weight: frecency[suggestion.id] ?? -Infinity }];
    })
    .sort(
      (left, right) =>
        left.tier - right.tier || right.weight - left.weight || left.order - right.order,
    )
    .map((ranked) =>
      query === "" && Number.isFinite(ranked.weight)
        ? { ...ranked.suggestion, recent: true }
        : ranked.suggestion,
    );
}

export interface SuggestionSources {
  readonly commands: readonly CommandInfo[];
  readonly skills: readonly SkillInfo[];
  readonly mentions: MentionRanking;
  readonly hasConversationContext: boolean;
  readonly recency: MentionRecency;
  readonly frecency: SuggestionFrecency;
}

export function suggestionsFor(
  kind: Exclude<SuggestionToken["kind"], "argument">,
  rawQuery: string,
  sources: SuggestionSources,
): readonly ComposerSuggestion[] {
  if (kind === "mention")
    return sources.mentions.rank(rawQuery, sources.hasConversationContext, sources.recency);

  return rankSuggestions(
    [
      ...sources.commands.map((command): SlashSuggestion => ({
        kind: "plugin-command",
        id: `plugin-command:${command.name}`,
        label: command.name,
        description: command.description,
        icon: "command",
        command,
      })),
      ...sources.skills.map((skill): SlashSuggestion => ({
        kind: "skill",
        id: `skill:${skill.name}`,
        label: skill.name,
        description: skill.description,
        icon: "skills",
        skill,
      })),
    ],
    rawQuery.trim().toLocaleLowerCase(),
    sources.frecency,
  );
}

type SuggestionGroup = "context" | "recent" | "files" | "commands" | "skills";

export function suggestionGroup(suggestion: ComposerSuggestion): SuggestionGroup {
  switch (suggestion.kind) {
    case "mention":
      return "context";
    case "file":
      return suggestion.recent === true ? "recent" : "files";
    case "plugin-command":
      return suggestion.recent === true ? "recent" : "commands";
    case "argument":
      return "commands";
    case "skill":
      return suggestion.recent === true ? "recent" : "skills";
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

interface TriggerMark {
  readonly kind: SuggestionToken["kind"];
  readonly start: number;
}

export interface MenuState {
  readonly token: SuggestionToken | undefined;
  readonly active: string | undefined;
  readonly highlighted: boolean;
  readonly dismissed: TriggerMark | undefined;
}

export const CLOSED_MENU: MenuState = {
  token: undefined,
  active: undefined,
  highlighted: false,
  dismissed: undefined,
};

export type MenuEvent =
  | { readonly kind: "token"; readonly token: SuggestionToken | undefined }
  | { readonly kind: "dismiss" }
  | { readonly kind: "select"; readonly id: string }
  | { readonly kind: "rows"; readonly ids: readonly string[] };

export function nextMenu(menu: MenuState, event: MenuEvent): MenuState {
  switch (event.kind) {
    case "token": {
      const token = event.token;

      if (token === undefined) return unchanged(menu, CLOSED_MENU);

      if (menu.dismissed?.kind === token.kind && menu.dismissed.start === token.start)
        return unchanged(menu, { ...CLOSED_MENU, dismissed: menu.dismissed });

      if (menu.token?.kind === token.kind && menu.token.start === token.start)
        return { ...menu, token };

      return unchanged(menu, { ...CLOSED_MENU, token });
    }

    case "dismiss":
      return unchanged(menu, {
        ...CLOSED_MENU,
        dismissed:
          menu.token === undefined
            ? menu.dismissed
            : { kind: menu.token.kind, start: menu.token.start },
      });
    case "select":
      return unchanged(menu, { ...menu, active: event.id, highlighted: true });
    case "rows":
      return menu.active === undefined || event.ids.includes(menu.active)
        ? menu
        : { ...menu, active: undefined };
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

export interface MenuPosition {
  readonly index: number;
  readonly count: number;
}

export type MenuKey =
  | { readonly kind: "move"; readonly to: number }
  | { readonly kind: "pick" }
  | { readonly kind: "hold" }
  | { readonly kind: "close" }
  | { readonly kind: "pass" };

const PAGE_ROWS = 8;

export function menuKey(
  key: Pick<
    KeyboardEvent,
    "key" | "keyCode" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "isComposing" | "repeat"
  >,
  position: MenuPosition,
): MenuKey {
  if (key.key === "Escape") return { kind: "close" };

  const down = key.key === "ArrowDown" || (key.ctrlKey && (key.key === "n" || key.key === "j"));
  const up = key.key === "ArrowUp" || (key.ctrlKey && (key.key === "p" || key.key === "k"));
  const count = Math.max(1, position.count);

  if (down || up) return { kind: "move", to: (position.index + (down ? 1 : -1) + count) % count };

  if (key.key === "Home" || key.key === "End")
    return { kind: "move", to: key.key === "Home" ? 0 : count - 1 };

  if (key.key === "PageDown" || key.key === "PageUp")
    return {
      kind: "move",
      to: Math.max(
        0,
        Math.min(count - 1, position.index + (key.key === "PageDown" ? PAGE_ROWS : -PAGE_ROWS)),
      ),
    };
  const enter = composerEnterAction(key);

  if (enter === "submit" || (key.key === "Tab" && !key.shiftKey))
    return { kind: key.repeat ? "hold" : "pick" };

  return enter === "submit-alternate" ? { kind: "hold" } : { kind: "pass" };
}

export type MenuPick =
  | { readonly kind: "accept"; readonly suggestion: ComposerSuggestion }
  | { readonly kind: "select"; readonly id: string }
  | { readonly kind: "hold" };

export function pickFor(
  fresh: boolean,
  shown: readonly ComposerSuggestion[],
  active: string | undefined,
  live: () => readonly ComposerSuggestion[],
): MenuPick {
  const rows = fresh ? shown : live();
  const suggestion = rows.find((row) => row.id === active);

  if (suggestion !== undefined) return { kind: "accept", suggestion };

  const first = rows[0];

  return fresh || first === undefined ? { kind: "hold" } : { kind: "select", id: first.id };
}

function unchanged(menu: MenuState, next: MenuState): MenuState {
  return menu.token === next.token &&
    menu.active === next.active &&
    menu.highlighted === next.highlighted &&
    menu.dismissed?.kind === next.dismissed?.kind &&
    menu.dismissed?.start === next.dismissed?.start
    ? menu
    : next;
}
