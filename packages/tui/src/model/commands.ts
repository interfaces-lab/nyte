/**
 * One command registry for slash input, the palette (Ctrl+K) and help:
 * built-ins, then setting rows, then plugin commands, then skills; first
 * claim wins (`availableSlashCommands`). Running a command is producing an
 * Intent, so the palette and `/name` execute the same way.
 */
import type { CommandInfo, SkillInfo } from "@nyte-ai/sdk";
import {
  availableSlashCommands,
  hasInlineSkills,
  parseComposerSubmission,
  SLASH_COMMANDS,
} from "../lib/slash.ts";
import type { BuiltinSlashName, SlashCommand } from "../lib/slash.ts";
import type { Intent } from "./msg.ts";
import { applyChoice, busyRefusal, matchChoice, settingRows } from "./settings.ts";
import type { SettingRow } from "./settings.ts";
import type { State } from "./state.ts";

export interface CommandEntry {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly source: "builtin" | "setting" | "plugin" | "skill";
  /** Typed as `/name …`, the draft goes out as the message (skills, client-side commands); the palette prefills it. */
  readonly prompt: boolean;
  /** Null when the command needs an argument it was not given (e.g. `/cd`), so the palette prefills instead. */
  readonly run: (argument: string) => Intent | null;
}

function refuse(reason: string): Intent {
  return { kind: "refuse", reason };
}

function noArgument(name: string, argument: string, intent: Intent): Intent {
  return argument === "" ? intent : refuse(`/${name} takes no argument`);
}

function builtin(name: BuiltinSlashName, argument: string): Intent | null {
  switch (name) {
    case "help":
      return { kind: "open", dialog: { kind: "list", purpose: { kind: "palette" } } };
    case "quit":
      return noArgument(name, argument, { kind: "quit" });
    case "resume":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "resume", sessions: [] } },
      });
    case "new":
      return noArgument(name, argument, {
        kind: "switch-session",
        session: "new",
        announce: false,
      });
    case "cd":
      return argument === "" ? null : { kind: "change-directory", path: argument };
    case "settings":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "settings", highlight: null } },
      });
    case "login":
    case "logout":
      return {
        kind: "open",
        dialog: { kind: "auth", mode: name, provider: argument === "" ? null : argument },
      };
    case "compact":
      return { kind: "compact", instructions: argument === "" ? null : argument };
    case "usage":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "text", content: "usage" },
      });
    case "tasks":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } },
      });
    case "tree":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "tree", filter: "default" },
      });
    case "edit":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "tree", filter: "users" },
      });
    case "plugins":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "text", content: "plugins" },
      });
    case "reload":
      return noArgument(name, argument, { kind: "reload" });
    case "update":
      return { kind: "update", version: argument === "" ? null : argument };
    case "skills":
      return noArgument(name, argument, {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "skills" } },
      });
    default: {
      const _exhaustive: never = name;

      return _exhaustive;
    }
  }
}

function setting(state: State, row: SettingRow, argument: string): Intent {
  const refused = busyRefusal(state, row);

  if (refused !== null) return refused;

  if (argument === "") {
    if (row.id === "model") return { kind: "open", dialog: { kind: "model" } };

    return { kind: "open", dialog: { kind: "list", purpose: { kind: "setting", key: row.id } } };
  }

  const choice = matchChoice(row, argument);

  if (choice === null)
    return refuse(
      `Unknown ${row.label}: ${argument}. Choices: ${row.choices.map((candidate) => candidate.id).join(", ")}`,
    );

  return applyChoice(state, row, choice);
}

export function skillsOf(state: State): ReadonlyMap<string, SkillInfo> {
  return new Map(
    (state.facts.session?.view?.catalog.skills ?? []).map((skill) => [skill.name, skill]),
  );
}

export function pluginCommands(state: State): readonly CommandInfo[] {
  return state.facts.session?.view?.catalog.commands ?? [];
}

/** The slash namespace in claim order, for completion. */
export function slashNamespace(state: State): readonly SlashCommand[] {
  return availableSlashCommands(
    new Map(
      pluginCommands(state).map((command) => [command.name, { description: command.description }]),
    ),
    settingRows(state).map((row) => ({ id: row.id, label: row.label })),
    skillsOf(state),
  );
}

export function commandRegistry(state: State): readonly CommandEntry[] {
  const rows = new Map(settingRows(state).map((row) => [row.id, row]));
  const plugins = new Map(pluginCommands(state).map((command) => [command.name, command]));

  const builtins = new Map<string, BuiltinSlashName>(
    SLASH_COMMANDS.map((command) => [command.name, command.name]),
  );

  return slashNamespace(state).map((command): CommandEntry => {
    const aliases = command.aliases ?? [];
    const base = { name: command.name, aliases, description: command.description };
    const builtinName = builtins.get(command.name);

    if (builtinName !== undefined)
      return {
        ...base,
        source: "builtin",
        prompt: false,
        run: (argument) => builtin(builtinName, argument),
      };
    const row = rows.get(command.name);

    if (row !== undefined)
      return {
        ...base,
        source: "setting",
        prompt: false,
        run: (argument) => setting(state, row, argument),
      };

    if (plugins.get(command.name)?.side === "core")
      return {
        ...base,
        source: "plugin",
        prompt: false,
        run: (argument) => ({ kind: "plugin-command", name: command.name, argument }),
      };

    return {
      ...base,
      source: command.kind === "prompt" ? "skill" : "plugin",
      prompt: true,
      run: () => ({ kind: "prefill", text: `/${command.name} ` }),
    };
  });
}

/** A typed `/name`: a built-in or its alias, a setting, a core plugin command, a skill; null sends the text as a message. */
export function resolveCommand(state: State, name: string): CommandEntry | null {
  return (
    commandRegistry(state).find((entry) => entry.name === name || entry.aliases.includes(name)) ??
    null
  );
}

/**
 * The command a `/name args` draft runs here, with its argument; null when
 * the draft goes out as a prompt (a skill, a client-side plugin command, an
 * unknown name, or any draft that names a skill inline, `/cd` excepted).
 */
export function runnableCommand(
  state: State,
  text: string,
): { readonly entry: CommandEntry; readonly argument: string } | null {
  const parsed = parseComposerSubmission(text);

  if (parsed.kind !== "command") return null;
  const entry = resolveCommand(state, parsed.command.name);

  if (entry === null || entry.prompt) return null;

  if (entry.name !== "cd" && hasInlineSkills(text, skillsOf(state))) return null;

  return { entry, argument: parsed.command.argument };
}
