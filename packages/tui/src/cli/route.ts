import { COMMANDS, findCommand } from "./commands.ts";
import type { CommandName } from "./commands.ts";

/**
 * What an argv asks for, decided from argv alone. Total: an unknown word is a route, never a throw,
 * so the entry knows the output format before anything can fail.
 *
 * - `help`: `help [path…]`, `<path> help`, `--help` or `-h` anywhere before `--`, or a group with no
 *   action word and no `default` action. `path` is the deepest known prefix.
 * - `version`: `--version` or `-v` before `--` and no help request.
 * - `command`: argv[0] names a command. `json` is true only when that command takes `--json` and
 *   argv has it before `--`.
 * - `chat`: argv is empty or argv[0] is an option. The TUI or print mode; `parseFlags` reads it.
 *   `json` is true when argv has `--json` before `--`, which only print mode takes.
 * - `unknown`: argv[0] is a word that names no command.
 */
export type Route =
  | { readonly kind: "help"; readonly path: readonly string[] }
  | { readonly kind: "version"; readonly json: boolean }
  | {
      readonly kind: "command";
      readonly name: CommandName;
      readonly args: readonly string[];
      readonly json: boolean;
    }
  | { readonly kind: "chat"; readonly args: readonly string[]; readonly json: boolean }
  | { readonly kind: "unknown"; readonly word: string };

export function route(argv: readonly string[]): Route {
  const separator = argv.indexOf("--");
  const options = separator < 0 ? argv : argv.slice(0, separator);
  const first = argv[0];
  const command = COMMANDS.find((candidate) => candidate.name === first);

  if (first === "help") {
    const asked = argv[1];
    const path = knownPath(argv.slice(1));

    if (asked !== undefined && path.length === 0) return { kind: "unknown", word: asked };

    return { kind: "help", path };
  }

  if (options.includes("--help") || options.includes("-h"))
    return { kind: "help", path: knownPath(options) };
  const path = knownPath(argv);

  if (path.length > 0 && argv[path.length] === "help") return { kind: "help", path };

  if (options.includes("--version") || options.includes("-v"))
    return { kind: "version", json: options.includes("--json") };

  if (first === undefined || first.startsWith("-"))
    return { kind: "chat", args: argv, json: options.includes("--json") };

  if (command === undefined) return { kind: "unknown", word: first };
  const spec = findCommand(command.name);

  if (
    argv.length === 1 &&
    spec?.subcommands !== undefined &&
    !spec.subcommands.some((action) => action.default === true)
  )
    return { kind: "help", path: [command.name] };

  const action =
    spec?.subcommands?.find((candidate) => candidate.name === argv[1]) ??
    spec?.subcommands?.find((candidate) => candidate.default === true);

  return {
    kind: "command",
    name: command.name,
    args: argv.slice(1),
    json:
      options.includes("--json") &&
      [...(spec?.options ?? []), ...(action?.options ?? [])].some(
        (option) => option.name === "json",
      ),
  };
}

/** The longest prefix of `words` that names a command and then one of its subcommands. */
function knownPath(words: readonly string[]): readonly string[] {
  const command = words[0] === undefined ? undefined : findCommand(words[0]);

  if (command === undefined) return [];
  const action = command.subcommands?.find((candidate) => candidate.name === words[1]);

  return action === undefined ? [command.name] : [command.name, action.name];
}
