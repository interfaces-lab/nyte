import { fstatSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import type { SessionId, Thinking } from "@nyte-ai/sdk";
import { CliError, shellCommand, suggest } from "./cli/errors.ts";
import type { NextStep } from "./cli/errors.ts";
import { THINKING_LEVELS } from "./lib/constants.ts";

export type ResumeTarget =
  | { readonly kind: "new" }
  | { readonly kind: "latest" }
  | { readonly kind: "session"; readonly id: string };

export interface RunFlags {
  readonly resume: ResumeTarget;
  readonly minimal: boolean;
  readonly print: boolean;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly effort?: Thinking;
  readonly trust?: boolean;
  /** A running `nyte host` to attach to in place of starting one; its token comes from `NYTE_HOST_TOKEN`. */
  readonly hostUrl?: string;
  /** `false` starts every new session of this run without context files (`Sessions.start`). */
  readonly contextFiles?: false;
  readonly rest: readonly string[];
}

const ROOT_OPTIONS = {
  resume: { type: "boolean", short: "c" },
  session: { type: "string" },
  minimal: { type: "boolean" },
  print: { type: "boolean", short: "p" },
  json: { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  provider: { type: "string" },
  model: { type: "string" },
  effort: { type: "string" },
  trust: { type: "boolean" },
  "no-trust": { type: "boolean" },
  "host-url": { type: "string" },
  "no-context-files": { type: "boolean" },
} as const;

const SEE_OPTIONS: readonly NextStep[] = [{ label: "See all options", argv: ["nyte", "--help"] }];

export function parseFlags(args: readonly string[]): RunFlags {
  const { values, positionals, tokens } = parseRootArgs(args);

  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.kind !== "option") continue;

    if (seen.has(token.name)) usage(`Provide --${token.name} only once.`);
    seen.add(token.name);
  }

  if (
    values.minimal === true &&
    (values.print === true || values.json === true || values.quiet === true)
  )
    usage("Can't combine --minimal with --print, --json or --quiet.");

  if (values.session !== undefined && values.resume === true)
    usage("Use either --session <SESSION_ID> or --resume.");

  if (values.trust === true && values["no-trust"] === true)
    usage("Use either --trust or --no-trust.");

  if (
    values["no-context-files"] === true &&
    (values.resume === true || values.session !== undefined)
  )
    usage(
      "Can't combine --no-context-files with --resume or --session: a chat keeps the context files it started with.",
    );

  if (values.session === "") usage("--session needs a session ID.");

  if (values["host-url"] !== undefined && !URL.canParse(values["host-url"]))
    usage("--host-url takes a URL, such as the one nyte host prints.");
  const effort = THINKING_LEVELS.find((level) => level === values.effort);

  if (values.effort !== undefined && effort === undefined)
    usage(`--effort takes ${THINKING_LEVELS.join(", ")}.`);

  let flags: RunFlags = {
    resume:
      values.session !== undefined
        ? { kind: "session", id: values.session }
        : values.resume === true
          ? { kind: "latest" }
          : { kind: "new" },
    minimal: values.minimal ?? false,
    print: values.print ?? false,
    json: values.json ?? false,
    quiet: values.quiet ?? false,
    rest: positionals,
  };

  if (values.provider !== undefined) flags = { ...flags, provider: values.provider };

  if (values.model !== undefined) flags = { ...flags, model: values.model };

  if (effort !== undefined) flags = { ...flags, effort };

  if (values.trust === true) flags = { ...flags, trust: true };

  if (values["no-trust"] === true) flags = { ...flags, trust: false };

  if (values["host-url"] !== undefined) flags = { ...flags, hostUrl: values["host-url"] };

  if (values["no-context-files"] === true) flags = { ...flags, contextFiles: false };

  return flags;
}

/**
 * The command a misplaced command name starts, as in `nyte --trust mcp list`: argv from that name
 * on, without the root options before it. Reads options loosely, so the command's own options don't
 * hide it. A prompt after `-p` may start with a command name.
 */
export function misplacedCommand(
  args: readonly string[],
  names: readonly string[],
): readonly string[] | undefined {
  const loose = parseArgs({
    args: [...args],
    allowPositionals: true,
    tokens: true,
    strict: false,
    options: ROOT_OPTIONS,
  });

  if (loose.values.print === true) return undefined;
  const first = loose.tokens.find((token) => token.kind === "positional");

  if (first?.kind !== "positional" || !names.includes(first.value)) return undefined;

  return args.slice(first.index);
}

function usage(message: string): never {
  throw new CliError("invalid_arguments", message, { next: SEE_OPTIONS });
}

/** Node's `parseArgs` errors name the token in its own words; this names it in the CLI's. */
function parseRootArgs(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      allowPositionals: true,
      tokens: true,
      strict: true,
      options: ROOT_OPTIONS,
    });
  } catch (cause) {
    throw rootArgsError(args, cause);
  }
}

function rootArgsError(args: readonly string[], cause: unknown): CliError {
  const loose = parseArgs({
    args: [...args],
    allowPositionals: true,
    tokens: true,
    strict: false,
    options: ROOT_OPTIONS,
  });

  for (const token of loose.tokens) {
    if (token.kind !== "option") continue;
    const known = Object.entries(ROOT_OPTIONS).find((entry) => entry[0] === token.name)?.[1];

    if (known === undefined) {
      const near = suggest(token.name, Object.keys(ROOT_OPTIONS));

      return new CliError(
        "unknown_option",
        `Unknown option ${token.rawName} for nyte.${near === undefined ? "" : ` Did you mean --${near}?`}`,
        { next: SEE_OPTIONS },
      );
    }

    if (
      known.type === "string" &&
      (token.value === undefined || (!token.inlineValue && token.value.startsWith("-")))
    )
      return new CliError("invalid_arguments", `${token.rawName} needs a value.`, {
        next: SEE_OPTIONS,
      });

    if (known.type === "boolean" && token.value !== undefined)
      return new CliError("invalid_arguments", `${token.rawName} takes no value.`, {
        next: SEE_OPTIONS,
      });
  }

  return new CliError(
    "invalid_arguments",
    cause instanceof Error ? cause.message : "Couldn't read the options.",
    { next: SEE_OPTIONS },
  );
}

/** Open the durable session in a terminal without admitting the original prompt again. The id rides as an inline option value, so one starting with a dash still parses, and the command POSIX-quotes it, so shell syntax and single quotes in it stay literal. */
export function sessionRecovery(id: SessionId) {
  const argv = ["nyte", `--session=${id}`];

  return { argv, command: shellCommand(argv) };
}

/** In TTY mode only, the single positional value after --resume is a session ID. */
export function resolveTuiResume(flags: RunFlags): RunFlags {
  if (flags.resume.kind !== "latest" || flags.rest.length === 0) return flags;

  if (flags.rest.length > 1) usage("--resume takes one session ID: nyte --resume [<SESSION_ID>].");
  const id = flags.rest[0];

  if (id === undefined) return flags;

  return { ...flags, resume: { kind: "session", id }, rest: [] };
}

/**
 * The prompt `-p` sends: the arguments, else piped stdin. Piped stdin beside an argument fails
 * rather than being dropped. Beside an argument, only a pipe or a file counts as piped: agent
 * harnesses hand commands a socket that never ends, so a socket is read only as the prompt itself.
 */
export async function readPrompt(
  rest: readonly string[],
  terminal: boolean,
  signal: AbortSignal,
): Promise<string> {
  const stdin = fstatSync(0);

  const piped =
    rest.length === 0 || (!terminal && (stdin.isFIFO() || stdin.isFile()))
      ? await readStdin(terminal, signal)
      : "";

  if (rest.length > 0 && piped.trim() !== "")
    usage("Pass the prompt as an argument or on stdin, not both.");
  const prompt = rest.length === 0 ? piped : rest.join(" ");

  if (prompt.trim() === "")
    throw new CliError("missing_input", "Can't send an empty prompt.", {
      next: [{ label: "Pass the prompt", argv: ["nyte", "-p", "<PROMPT>"] }],
    });

  return prompt;
}

/** Everything piped to stdin; `""` when stdin is a terminal, which is never read as input. A signal while it waits ends it as `Canceled.`. */
export async function readStdin(terminal: boolean, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();

  if (terminal) return "";
  const chunks: Buffer[] = [];
  signal?.addEventListener("abort", cancelStdin, { once: true });

  try {
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }

    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", cancelStdin);
  }

  return Buffer.concat(chunks).toString("utf8").replace(/\n$/u, "");
}

function cancelStdin(): void {
  process.stdin.destroy(new CliError("canceled", "Canceled."));
}
