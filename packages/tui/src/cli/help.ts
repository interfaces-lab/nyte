import { THINKING_LEVELS } from "../lib/constants.ts";
import { COMMANDS, findCommand } from "./commands.ts";
import type { ActionSpec, CommandSpec, Example, HelpGroup, OptionSpec } from "./commands.ts";
import { formatCommand, paint } from "./format.ts";
import type { Presentation } from "./mode.ts";

interface Entry {
  readonly syntax: string;
  readonly summary: string;
}

const MAX_WIDTH = 80;

/** Where descriptions start at most; each section starts them 2 columns past its widest syntax. */
const MAX_COLUMN = 32;

const GROUPS: readonly HelpGroup[] = ["Chat", "Sign-in", "Tools", "Host", "Maintenance"];

/** The chat entry has no command name: `nyte` with root options opens the app or runs one prompt. */
const CHAT: readonly Entry[] = [
  { syntax: "nyte", summary: "Open the full-screen app" },
  { syntax: "nyte -p <PROMPT>", summary: "Send one prompt and print the answer" },
  {
    syntax: "nyte --resume [<SESSION_ID>]",
    summary: "Reopen the latest chat or the one with this ID",
  },
  { syntax: "nyte --minimal", summary: "Open the compact terminal mode (experimental)" },
];

const ROOT_OPTIONS: readonly OptionSpec[] = [
  { name: "resume", short: "c", summary: "Continue the latest chat" },
  {
    name: "effort",
    value: "<LEVEL>",
    summary: "Set the thinking level, from off to max",
  },
  {
    name: "host-url",
    value: "<URL>",
    summary: "Attach to a running host with NYTE_HOST_TOKEN",
  },
  { name: "json", summary: "Print the run as JSON lines" },
  { name: "minimal", summary: "Open the compact mode; needs terminal stdin and stdout" },
  { name: "model", value: "<ID>", summary: "Use this model for this chat; the default stays" },
  { name: "no-context-files", summary: "Start new chats without AGENTS.md or CLAUDE.md" },
  { name: "no-trust", summary: "Save that this folder's project files don't load" },
  { name: "print", short: "p", summary: "Send one prompt, print the answer and exit" },
  { name: "provider", value: "<ID>", summary: "Look up --model in this provider" },
  {
    name: "quiet",
    short: "q",
    summary: "Print only the answer, without tool names",
  },
  { name: "session", value: "<SESSION_ID>", summary: "Open or send to the chat with this ID" },
  { name: "trust", summary: "Save that this folder's project files load" },
];

const ROOT_EXAMPLES: readonly Example[] = [
  { label: "Ask once and print the answer", argv: ["nyte", "-p", "<PROMPT>"] },
  { label: "Send a prompt to the latest chat", argv: ["nyte", "-p", "--resume", "<PROMPT>"] },
  { label: "See a command's options", argv: ["nyte", "help", "mcp"] },
];

const ROOT_NOTES: readonly string[] = [
  "A prompt argument needs -p. Without one, piped stdin is the prompt; a prompt argument and piped stdin together are an error.",
  "-p prints the answer on stdout. Tool names, the receipt and errors go to stderr.",
  '--json prints JSON lines on stdout: {"type":"text","text"} as the answer streams, {"type":"tool","name"} per tool call, then {"type":"result","outcome":"completed","session","next"}. A run that doesn\'t complete prints no result; stderr gets one JSON error document with the session in data.',
  "-p exits 0 when the run completes, 1 when it fails or another client stops it, 2 when the agent asks a question, and 130 or 143 when Ctrl+C or SIGTERM stops it.",
  `--effort takes ${THINKING_LEVELS.join(", ")}.`,
  "nyte --session <SESSION_ID> in a terminal opens a chat without sending anything.",
  "--trust and --no-trust save the decision for this folder, or the chat's folder, before the chat opens or the prompt is sent. From a script, use nyte trust --yes or nyte untrust.",
];

const HELP_OPTION: OptionSpec = {
  name: "help",
  short: "h",
  summary: "Show help for nyte or a command",
};

const VERSION_OPTION: OptionSpec = {
  name: "version",
  short: "v",
  summary: "Print the installed version",
};

/**
 * Help for `path` (`[]` for the root, `[group, action]` for an action), rendered from `COMMANDS` in
 * the baseline's order: usage and summary, Commands (root: one section per `HelpGroup`), Options
 * (alphabetical), Global Options (listed at the root, a pointer to it elsewhere), Examples, Notes. Headings are Title Case with a colon, bold magenta when colored; command
 * and option names bold; everything else normal foreground, never faint. Entries indent 2, example
 * commands 4. A description that doesn't fit beside its syntax at `width` moves to the next line.
 * Fits 80 columns.
 */
export function renderHelp(
  path: readonly string[],
  presentation: Presentation,
  width: number,
): string {
  const command = path[0] === undefined ? undefined : findCommand(path[0]);
  const action = command?.subcommands?.find((candidate) => candidate.name === path[1]);

  const page =
    command === undefined
      ? rootPage()
      : action === undefined
        ? commandPage(command)
        : actionPage(command, action);

  const layout = { presentation, width: Math.min(width, MAX_WIDTH) };

  return [
    `${heading("Usage:", presentation)} ${paint(presentation, "bold", "nyte")}${page.usage}`,
    "",
    page.summary,
    ...page.sections.flatMap((section) => renderSection(section, layout)),
    ...(page.examples.length === 0
      ? []
      : [
          "",
          heading("Examples:", presentation),
          ...page.examples.flatMap((example, index) => [
            ...(index === 0 ? [] : [""]),
            `  ${example.label}:`,
            formatCommand(example.argv, presentation),
          ]),
        ]),
    ...(page.notes.length === 0
      ? []
      : [
          "",
          heading("Notes:", presentation),
          ...page.notes.flatMap((note) => wrap(note, layout.width - 2).map((line) => `  ${line}`)),
        ]),
  ].join("\n");
}

/** A heading over entries, or a heading with one line beside it. */
type Section =
  | { readonly kind: "entries"; readonly title: string; readonly entries: readonly Entry[] }
  | { readonly kind: "line"; readonly title: string; readonly line: string };

interface Page {
  readonly usage: string;
  readonly summary: string;
  readonly sections: readonly Section[];
  readonly examples: readonly Example[];
  readonly notes: readonly string[];
}

/** Every page but the root's points to the root for the options every command takes. */
const GLOBAL_POINTER: Section = { kind: "line", title: "Global Options", line: "See nyte --help" };

function rootPage(): Page {
  return {
    usage: " [<command>] [options]",
    summary: "Run durable agent chats in your terminal",
    sections: [
      ...GROUPS.map((group) => ({
        kind: "entries" as const,
        title: group,
        entries: [
          ...(group === "Chat" ? CHAT : []),
          ...COMMANDS.filter((command) => command.group === group).map((command) => ({
            syntax: group === "Chat" ? `nyte ${command.name}` : command.name,
            summary: command.summary,
          })),
        ],
      })),
      { kind: "entries", title: "Options", entries: optionEntries(ROOT_OPTIONS) },
      {
        kind: "entries",
        title: "Global Options",
        entries: optionEntries([HELP_OPTION, VERSION_OPTION]),
      },
    ],
    examples: ROOT_EXAMPLES,
    notes: ROOT_NOTES,
  };
}

/** A leaf command's page, or a group's: its actions, then the options every action shares. */
function commandPage(command: CommandSpec): Page {
  const sections = [
    {
      kind: "entries" as const,
      title: "Commands",
      entries: (command.subcommands ?? []).map((action) => ({
        syntax: action.name,
        summary: action.default === true ? `${action.summary} (default)` : action.summary,
      })),
    },
    { kind: "entries" as const, title: "Options", entries: optionEntries(command.options ?? []) },
  ];

  return {
    usage: ` ${command.name} ${command.usage}`,
    summary: command.summary,
    sections: [...sections.filter((section) => section.entries.length > 0), GLOBAL_POINTER],
    examples: command.examples ?? [],
    notes: command.notes ?? [],
  };
}

/** `nyte mcp add --help`: the group's shared options and the action's own, in one list. A default action's name is optional in its usage. */
function actionPage(command: CommandSpec, action: ActionSpec): Page {
  const options = optionEntries([...(command.options ?? []), ...(action.options ?? [])]);
  const name = action.default === true ? `[${action.name}]` : action.name;

  return {
    usage: ` ${command.name} ${name}${action.usage === "" ? "" : ` ${action.usage}`}`,
    summary: action.summary,
    sections: [
      ...(options.length === 0
        ? []
        : [{ kind: "entries" as const, title: "Options", entries: options }]),
      GLOBAL_POINTER,
    ],
    examples: action.examples ?? [],
    notes: action.notes ?? [],
  };
}

function optionEntries(options: readonly OptionSpec[]): Entry[] {
  return options
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((option) => ({
      syntax: `${option.short === undefined ? "" : `-${option.short}, `}--${option.name}${option.value === undefined ? "" : ` ${option.value}`}`,
      summary: option.summary,
    }));
}

function renderSection(
  section: Section,
  layout: { readonly presentation: Presentation; readonly width: number },
): string[] {
  const title = heading(`${section.title}:`, layout.presentation);

  if (section.kind === "line") return ["", `${title} ${section.line}`];
  const entries = section.entries;
  const column = Math.min(MAX_COLUMN, Math.max(...entries.map((entry) => entry.syntax.length)) + 4);

  return ["", title, ...entries.flatMap((entry) => renderEntry(entry, { ...layout, column }))];
}

function renderEntry(
  entry: Entry,
  layout: { readonly presentation: Presentation; readonly width: number; readonly column: number },
): string[] {
  const head = `  ${paint(layout.presentation, "bold", entry.syntax)}`;
  const used = 2 + entry.syntax.length;
  const fits = layout.column + entry.summary.length <= layout.width;

  if (fits && used + 2 <= layout.column)
    return [`${head}${" ".repeat(layout.column - used)}${entry.summary}`];

  if (fits) return [head, `${" ".repeat(layout.column)}${entry.summary}`];

  return [head, ...wrap(entry.summary, layout.width - 4).map((line) => `    ${line}`)];
}

function heading(text: string, presentation: Presentation): string {
  return paint(presentation, "bold", paint(presentation, "magenta", text));
}

/** Breaks between words only, so a command or path longer than `width` stays whole. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
      continue;
    }

    line = line === "" ? word : `${line} ${word}`;
  }

  return [...lines, line];
}
