/**
 * Slash tokens, decided once here. A token is one of three kinds:
 *
 * - `action`: runs the moment Enter accepts it and leaves the composer empty,
 *   with whatever argument was typed after it. Built-in operations and plugin
 *   commands. `/cd` first completes its token so a directory can be entered.
 * - `setting`: `/name` opens the choice picker; `/name <choice>` applies the
 *   choice at once. The model, the thinking level, the theme, and every
 *   setting a plugin declares.
 * - `prompt`: stays in the composer; the token expands into the message when
 *   it is sent. Skills.
 *
 * Also the parser that classifies a draft as chat or command, completion for
 * the token under the cursor, and inline skill expansion. Nothing here touches
 * a renderer.
 *
 * Based on opencode v2, where every slash command executes on Enter and only
 * prompt templates and skills reach the model:
 * https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/component/prompt/autocomplete.tsx
 */
import fuzzysort from "fuzzysort";
import { completionTrigger } from "@nyte-ai/client";
import { formatSkillInvocation } from "@nyte-ai/core/plugins";
import type { Skill } from "@nyte-ai/schema";

export interface ParsedSlashCommand {
  readonly name: string;
  readonly argument: string;
}

export type ComposerSubmission =
  | { readonly kind: "empty" }
  | { readonly kind: "command"; readonly command: ParsedSlashCommand }
  | { readonly kind: "prompt"; readonly text: string }
  /** `!cmd` runs in the chat's workspace; `retain` (`!`, not `!!`) sends its output with the next prompt. */
  | { readonly kind: "shell"; readonly command: string; readonly retain: boolean };

function isAsciiLetter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);

  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isSlashCommandNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);

  return isAsciiLetter(character) || (code >= 48 && code <= 57) || character === "-";
}

/** Parse one slash command while preserving spaces inside its argument. */
function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  const value = input.trim();
  const first = value[1];

  if (
    !value.startsWith("/") ||
    first === undefined ||
    first === "-" ||
    !isSlashCommandNameCharacter(first)
  ) {
    return undefined;
  }

  if (value.includes("\n") || value.includes("\r")) return undefined;

  let nameEnd = 2;

  while (nameEnd < value.length) {
    const character = value[nameEnd];

    if (character === undefined || character.trim() === "") break;

    if (!isSlashCommandNameCharacter(character)) return undefined;
    nameEnd += 1;
  }

  return {
    name: value.slice(1, nameEnd).toLowerCase(),
    argument: value.slice(nameEnd).trim(),
  };
}

/** Classify composer text once at the chat-or-command boundary. */
export function parseComposerSubmission(input: string): ComposerSubmission {
  const text = input.trim();

  if (text === "") return { kind: "empty" };

  // Shell execution is positional, unlike slash completion within a draft.
  if (input.startsWith("!")) {
    const retain = !input.startsWith("!!");
    const command = input.slice(retain ? 1 : 2).trim();

    if (command !== "") return { kind: "shell", command, retain };
  }

  const command = parseSlashCommand(text);

  return command === undefined ? { kind: "prompt", text } : { kind: "command", command };
}

/** Recalling a conversation message must not turn it into shell execution. */
export function promptDraft(text: string): string {
  return text.startsWith("!") ? ` ${text}` : text;
}

type SlashKind = "action" | "setting" | "prompt";

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  readonly kind: SlashKind;
  readonly aliases?: readonly string[];
}

export const SLASH_COMMANDS = [
  { name: "help", description: "Browse commands", kind: "action" },
  { name: "settings", description: "Change settings", kind: "action" },
  { name: "login", description: "Sign in to a provider", kind: "action" },
  { name: "logout", description: "Sign out of a provider", kind: "action" },
  { name: "quit", description: "Quit Nyte", kind: "action" },
  {
    name: "resume",
    description: "Resume a chat",
    kind: "action",
    aliases: ["sessions", "continue"],
  },
  { name: "new", description: "Start a new chat", kind: "action" },
  { name: "cd", description: "Change this chat's working directory", kind: "action" },
  { name: "compact", description: "Compact conversation history", kind: "action" },
  { name: "usage", description: "Show token usage and cost", kind: "action" },
  { name: "tasks", description: "Inspect subagents and background commands", kind: "action" },
  { name: "tree", description: "Move to a session branch", kind: "action" },
  { name: "edit", description: "Edit a message you sent", kind: "action" },
  { name: "plugins", description: "List loaded plugins", kind: "action" },
  { name: "reload", description: "Reload plugins and skills", kind: "action" },
  { name: "update", description: "Update nyte to the latest release", kind: "action" },
  { name: "skills", description: "Browse skills", kind: "action" },
] as const satisfies readonly SlashCommand[];

type BuiltinSlashCommand = (typeof SLASH_COMMANDS)[number];

export type BuiltinSlashName = BuiltinSlashCommand["name"];

function aliasesFor(command: SlashCommand): readonly string[] {
  return command.aliases ?? [];
}

/** A setting the shell can open or apply by name. */
export interface SlashSetting {
  readonly id: string;
  readonly label: string;
}

/**
 * The whole namespace, first claim wins: built-ins, then settings, then
 * plugin commands, then skills.
 */
export function availableSlashCommands(
  pluginCommands: ReadonlyMap<string, { readonly description: string }>,
  settings: readonly SlashSetting[],
  skills: ReadonlyMap<string, Skill>,
): SlashCommand[] {
  const builtins: readonly SlashCommand[] = SLASH_COMMANDS;
  const reserved = new Set(builtins.flatMap((command) => [command.name, ...aliasesFor(command)]));
  const claimed: SlashCommand[] = [...builtins];

  const claim = (command: SlashCommand): void => {
    if (reserved.has(command.name)) return;
    reserved.add(command.name);
    claimed.push(command);
  };

  for (const setting of settings) {
    claim({ name: setting.id, description: setting.label, kind: "setting" });
  }

  for (const [name, command] of pluginCommands) {
    claim({ name, description: command.description, kind: "action" });
  }

  for (const [name, skill] of skills) {
    claim({ name, description: skill.description, kind: "prompt" });
  }

  return claimed;
}

// Namespace arrays are immutable snapshots. A new namespace gets a new array.
const sortedCommands = new WeakMap<readonly SlashCommand[], SlashCommand[]>();

const MAX_SUGGESTIONS = 10;

/** Under this a description only matched by coincidence, the way `/usage` finds "Use for…". */
const DESCRIPTION_MATCH = 0.5;

/** Shorter than this, a query is being typed toward a name, not searched for a topic. */
const DESCRIPTION_QUERY = 3;

/** Length of the shortest name or alias the query is a prefix of. */
function prefixLength(command: SlashCommand, query: string): number | undefined {
  let shortest: number | undefined;

  for (const name of [command.name, ...aliasesFor(command)]) {
    if (!name.toLowerCase().startsWith(query)) continue;

    if (shortest === undefined || name.length < shortest) shortest = name.length;
  }

  return shortest;
}

/**
 * What a typed name should find, in the order a typist expects it: everything
 * the query is a prefix of, shortest first, then fuzzy name matches, and only
 * then descriptions. An empty query lists the whole namespace A–Z.
 */
function commandSuggestions(query: string, commands: readonly SlashCommand[]): SlashCommand[] {
  let sorted = sortedCommands.get(commands);

  if (sorted === undefined) {
    sorted = commands.toSorted((left, right) => left.name.localeCompare(right.name));
    sortedCommands.set(commands, sorted);
  }

  if (query === "") return [...sorted];

  const needle = query.toLowerCase();
  const prefixed: { command: SlashCommand; length: number }[] = [];
  const rest: SlashCommand[] = [];

  for (const command of sorted) {
    const length = prefixLength(command, needle);

    if (length === undefined) rest.push(command);
    else prefixed.push({ command, length });
  }

  // Stable, so an exact match leads and equal-length names stay A–Z.
  prefixed.sort((left, right) => left.length - right.length);

  if (prefixed.length >= MAX_SUGGESTIONS) {
    return prefixed.slice(0, MAX_SUGGESTIONS).map((entry) => entry.command);
  }

  const fuzzy = fuzzysort.go(needle, rest, {
    keys: [(command) => command.name, (command) => aliasesFor(command).join(" "), "description"],
    limit: MAX_SUGGESTIONS - prefixed.length,
    threshold: 0.001,
    scoreFn(results) {
      const named = Math.max(results[0]?.score ?? 0, results[1]?.score ?? 0);

      if (named > 0) return 1 + named;

      if (needle.length < DESCRIPTION_QUERY) return 0;
      const described = results[2]?.score ?? 0;

      return described >= DESCRIPTION_MATCH ? described : 0;
    },
  });

  return [...prefixed.map((entry) => entry.command), ...fuzzy.map((result) => result.obj)].slice(
    0,
    MAX_SUGGESTIONS,
  );
}

/** A token is the command line when nothing but whitespace precedes it. */
function opensDraft(text: string, start: number): boolean {
  return text.slice(0, start).trim() === "";
}

/** The `/token` the cursor is inside, with the commands it matches. */
interface SlashCompletion {
  /** The token an accepted command replaces. */
  readonly start: number;
  readonly end: number;
  /** Whether the token opens the buffer rather than interrupting a draft. */
  readonly leading: boolean;
  readonly commands: readonly SlashCommand[];
}

/** `undefined` means the cursor is not in a slash token at all. */
export function slashCompletion(
  value: string,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
  cursor = value.length,
): SlashCompletion | undefined {
  const trigger = completionTrigger(value, cursor);

  if (trigger?.kind !== "/") return undefined;

  return {
    start: trigger.start,
    end: trigger.end,
    leading: opensDraft(value, trigger.start),
    commands: commandSuggestions(trigger.query, commands),
  };
}

/** `/name` tokens the way the composer writes them: at the start of a word. */
const INLINE_SKILL_PATTERN = /(?<=^|\s)\/([A-Za-z][A-Za-z0-9-]*)/g;

interface SkillToken {
  readonly start: number;
  readonly end: number;
  readonly skill: Skill;
}

function skillTokens(text: string, skills: ReadonlyMap<string, Skill>): SkillToken[] {
  const tokens: SkillToken[] = [];

  for (const match of text.matchAll(INLINE_SKILL_PATTERN)) {
    const skill = skills.get(match[1] ?? "");

    if (skill === undefined) continue;
    tokens.push({ start: match.index, end: match.index + match[0].length, skill });
  }

  return tokens;
}

/** Whether a draft invokes a skill from inside the prompt rather than at its head. */
export function hasInlineSkills(text: string, skills: ReadonlyMap<string, Skill>): boolean {
  return skillTokens(text, skills).some((token) => !opensDraft(text, token.start));
}

/**
 * Replace every `/skill` token with that skill's instructions, so one message
 * can invoke several. The composer, the history, and the transcript keep the
 * short token.
 */
export function expandInlineSkills(text: string, skills: ReadonlyMap<string, Skill>): string {
  let expanded = "";
  let cursor = 0;

  for (const token of skillTokens(text, skills)) {
    expanded += text.slice(cursor, token.start) + formatSkillInvocation(token.skill);
    cursor = token.end;
  }

  return expanded + text.slice(cursor);
}

interface SkillInvocation {
  readonly source: string;
  readonly name: string;
  readonly path: string;
}

/**
 * Core writes a skill invocation as one `<skill>` block, so a client can find
 * the instructions again and show the short token the user typed instead.
 */
const SKILL_INVOCATION_PATTERN =
  /<skill name="([^"\n]*)" location="([^"\n]*)">\n[\s\S]*?\n<\/skill>/g;

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function extractSkillInvocations(text: string): SkillInvocation[] {
  const invocations: SkillInvocation[] = [];

  for (const match of text.matchAll(SKILL_INVOCATION_PATTERN)) {
    const [source, name, path] = match;

    if (name === undefined || path === undefined) continue;
    invocations.push({ source, name: unescapeXml(name), path: unescapeXml(path) });
  }

  return invocations;
}

export function resolveSlashCommand(name: string): BuiltinSlashCommand | undefined {
  return SLASH_COMMANDS.find(
    (command) => command.name === name || aliasesFor(command).includes(name),
  );
}

export function slashCommandLabel(command: SlashCommand): string {
  return `/${command.name}`;
}

type SlashAcceptance =
  | { readonly action: "execute" }
  | { readonly action: "complete"; readonly token: string };

/**
 * What accepting a highlighted command does. Enter runs an action or a
 * setting and leaves a prompt in the composer to be sent; `/cd` waits for its
 * directory argument. Tab only completes.
 * Text drafted after the token survives as its argument, so with a `rest` the
 * token is completed rather than run.
 */
export function acceptSlashCommand(
  command: SlashCommand,
  via: "return" | "tab",
  rest = "",
): SlashAcceptance {
  if (rest !== "") return { action: "complete", token: `/${command.name}` };

  if (via === "tab" || command.kind === "prompt" || command.name === "cd") {
    return { action: "complete", token: `/${command.name} ` };
  }

  return { action: "execute" };
}
