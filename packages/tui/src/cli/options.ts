import { parseArgs } from "node:util";
import { COMMANDS, findCommand } from "./commands.ts";
import type { CommandName } from "./commands.ts";
import { CliError, suggest } from "./errors.ts";

type Spec<C extends CommandName> = Extract<(typeof COMMANDS)[number], { readonly name: C }>;

type Action<C extends CommandName> =
  Spec<C> extends { readonly subcommands: readonly (infer A)[] } ? A : never;

type Names<T> = T extends { readonly options: readonly { readonly name: infer N extends string }[] }
  ? N
  : never;

/** A command with actions, such as `mcp`. */
export type GroupName = {
  [C in CommandName]: [Action<C>] extends [never] ? never : C;
}[CommandName];

type ActionNames<T> = T extends { readonly name: infer N extends string } ? N : never;

/** The actions `COMMANDS` lists for a group. */
export type ActionName<C extends CommandName> = ActionNames<Action<C>>;

/** The long option names a command takes: a group's shared ones plus action `A`'s own. */
export type OptionName<C extends CommandName, A extends ActionName<C> = never> =
  | Names<Spec<C>>
  | Names<Extract<Action<C>, { readonly name: A }>>;

export interface CommandArgs<C extends CommandName, A extends ActionName<C> = never> {
  readonly positionals: readonly string[];
  has(name: OptionName<C, A>): boolean;
  /** The value of an option that takes one (`--a=b` or `--a b`), or `undefined`. */
  value(name: OptionName<C, A>): string | undefined;
  /** Every value of a `repeatable` option, in order. */
  values(name: OptionName<C, A>): readonly string[];
}

export interface ActionArgs<C extends GroupName> {
  readonly action: ActionName<C>;
  /** What follows the action word, for `parseCommandArgs`. */
  readonly args: readonly string[];
}

/**
 * Splits a group's arguments into the action its first word names and the rest. No first word, or
 * an option there, runs the group's `default` action when it has one; without one, an option there
 * fails, because options follow the action. A word that names no action fails as a usage error with
 * at most one "Did you mean".
 */
export function readAction<C extends GroupName>(name: C, args: readonly string[]): ActionArgs<C> {
  const word = args[0];
  const actions = findCommand(name)?.subcommands ?? [];
  const fallback = actions.find((action) => action.default === true)?.name;
  const next = [{ label: "See the commands", argv: ["nyte", name, "--help"] }];

  if (namesAction(name, word)) return { action: word, args: args.slice(1) };

  if ((word === undefined || word.startsWith("-")) && namesAction(name, fallback))
    return { action: fallback, args };

  if (word === undefined)
    throw new CliError("missing_input", `Name a command for nyte ${name}.`, { next });

  if (word.startsWith("-"))
    throw new CliError(
      "invalid_arguments",
      `Name a nyte ${name} command before ${word.split("=")[0] ?? word}.`,
      { next },
    );

  const near = suggest(
    word,
    actions.map((action) => action.name),
  );

  throw new CliError(
    "unknown_command",
    `Unknown command ${word} for nyte ${name}.${near === undefined ? "" : ` Did you mean ${near}?`}`,
    { next },
  );
}

/**
 * Reads a command's arguments against the options its `COMMANDS` entry lists, so help and parsing
 * share one list. A group passes the action `readAction` found, and gets the group's options plus
 * that action's. Every mistake is a usage `CliError` naming the token and the full command path,
 * before any work: an unknown option (with at most one "Did you mean"), a missing or unexpected
 * value, a repeated option, or more than `maxPositionals` arguments. Never accepts a prefix. A
 * lone `-` is a value, which by convention names stdin.
 */
export function parseCommandArgs<C extends CommandName, A extends ActionName<C> = never>(
  name: C,
  args: readonly string[],
  maxPositionals: number,
  ...action: [ActionName<C>] extends [never] ? [] : [action: A]
): CommandArgs<C, A> {
  const command = findCommand(name);
  const chosen = command?.subcommands?.find((candidate) => candidate.name === action[0]);
  const options = [...(command?.options ?? []), ...(chosen?.options ?? [])];
  const path = ["nyte", name, ...action];
  const help = { next: [{ label: "See the options", argv: [...path, "--help"] }] };
  const values = new Map<string, string[]>();
  const positionals: string[] = [];

  const tokens = parseArgs({
    args: [...args],
    options: Object.fromEntries(
      options.map((option) => [
        option.name,
        option.short === undefined
          ? { type: option.value === undefined ? ("boolean" as const) : ("string" as const) }
          : {
              type: option.value === undefined ? ("boolean" as const) : ("string" as const),
              short: option.short,
            },
      ]),
    ),
    strict: false,
    allowPositionals: true,
    tokens: true,
  }).tokens;

  for (const token of tokens) {
    if (token.kind === "option-terminator") continue;

    if (token.kind === "positional") {
      if (positionals.length === maxPositionals)
        throw new CliError(
          "invalid_arguments",
          `Unexpected argument ${token.value} for ${path.join(" ")}.`,
          help,
        );
      positionals.push(token.value);
      continue;
    }

    const spec = options.find((option) => option.name === token.name);

    if (spec === undefined) {
      const near = suggest(
        token.name,
        options.map((option) => option.name),
      );

      throw new CliError(
        "unknown_option",
        `Unknown option ${token.rawName} for ${path.join(" ")}.${near === undefined ? "" : ` Did you mean --${near}?`}`,
        help,
      );
    }

    if (values.has(spec.name) && spec.repeatable !== true)
      throw new CliError("invalid_arguments", `Provide --${spec.name} only once.`, help);

    if (spec.value === undefined) {
      if (token.value !== undefined)
        throw new CliError("invalid_arguments", `${token.rawName} takes no value.`, help);
      values.set(spec.name, []);
      continue;
    }

    if (
      token.value === undefined ||
      (!token.inlineValue && token.value !== "-" && token.value.startsWith("-"))
    )
      throw new CliError("invalid_arguments", `${token.rawName} needs a value.`, help);
    values.set(spec.name, [...(values.get(spec.name) ?? []), token.value]);
  }

  return {
    positionals,
    has: (option) => values.has(option),
    value: (option) => values.get(option)?.[0],
    values: (option) => values.get(option) ?? [],
  };
}

function namesAction<C extends CommandName>(
  name: C,
  word: string | undefined,
): word is ActionName<C> {
  return findCommand(name)?.subcommands?.some((action) => action.name === word) === true;
}
