import process from "node:process";
import { parseArgs } from "node:util";
import type { SessionId, Thinking } from "@nyte-ai/sdk";
import { THINKING_LEVELS } from "./lib/constants.ts";

export type ResumeTarget =
  | { readonly kind: "new" }
  | { readonly kind: "latest" }
  | { readonly kind: "session"; readonly id: string };

export interface RunFlags {
  readonly resume: ResumeTarget;
  readonly print: boolean;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly effort?: Thinking;
  readonly rest: readonly string[];
}

export function parseFlags(args: readonly string[]): RunFlags {
  const { values, positionals, tokens } = parseArgs({
    args: [...args],
    allowPositionals: true,
    tokens: true,
    strict: true,
    options: {
      resume: { type: "boolean", short: "c" },
      session: { type: "string" },
      print: { type: "boolean", short: "p" },
      json: { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
      provider: { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
    },
  });

  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.kind !== "option") continue;

    if (seen.has(token.name)) throw new Error(`Provide --${token.name} only once.`);
    seen.add(token.name);
  }

  if (values.session !== undefined && values.resume === true) {
    throw new Error("Use either --session <session-id> or --resume.");
  }

  if (values.session === "") throw new Error("--session requires a non-empty session ID.");
  const effort = THINKING_LEVELS.find((level) => level === values.effort);

  if (values.effort !== undefined && effort === undefined) {
    throw new Error(`--effort must be one of: ${THINKING_LEVELS.join(", ")}.`);
  }

  let flags: RunFlags = {
    resume:
      values.session !== undefined
        ? { kind: "session", id: values.session }
        : values.resume === true
          ? { kind: "latest" }
          : { kind: "new" },
    print: values.print ?? false,
    json: values.json ?? false,
    quiet: values.quiet ?? false,
    rest: positionals,
  };

  if (values.provider !== undefined) flags = { ...flags, provider: values.provider };

  if (values.model !== undefined) flags = { ...flags, model: values.model };

  if (effort !== undefined) flags = { ...flags, effort };

  return flags;
}

/** Open the durable session in a terminal without admitting the original prompt again. The id rides as an inline option value, so one starting with a dash still parses, and the command POSIX-quotes it, so shell syntax and single quotes in it stay literal. */
export function sessionRecovery(id: SessionId) {
  const argv = ["nyte", `--session=${id}`];

  return {
    argv,
    command: argv
      .map((arg) => (/^[A-Za-z0-9_./=-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`))
      .join(" "),
  };
}

/** In TTY mode only, the single positional value after --resume is a session ID. */
export function resolveTuiResume(flags: RunFlags): RunFlags {
  if (flags.resume.kind !== "latest" || flags.rest.length === 0) return flags;

  if (flags.rest.length > 1) throw new Error("Usage: nyte --resume [<session-id>]");
  const id = flags.rest[0];

  if (id === undefined) return flags;

  return { ...flags, resume: { kind: "session", id }, rest: [] };
}

/** True when this invocation should run one prompt and exit. */
export function wantsPrint(flags: RunFlags, stdoutIsTty: boolean, stdinIsTty: boolean): boolean {
  if (flags.print || flags.json || flags.quiet) return true;

  return !stdinIsTty || (!stdoutIsTty && flags.rest.length > 0);
}

export async function readStdin(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();

  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];

  const cancel = (): void => {
    process.stdin.destroy(new Error("Input cancelled.", { cause: signal?.reason }));
  };

  signal?.addEventListener("abort", cancel, { once: true });

  try {
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }

    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", cancel);
  }

  return Buffer.concat(chunks).toString("utf8").replace(/\n$/u, "");
}

export function parseServeArgs(args: readonly string[]): {
  readonly port: number;
  readonly token?: string;
} {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    options: { port: { type: "string" }, token: { type: "string" } },
  });

  const port = Number(values.port ?? "0");

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be a port number. Run `nyte serve --help`.");
  }

  return values.token === undefined ? { port } : { port, token: values.token };
}

export function parseUpdateArgs(
  args: readonly string[],
):
  | { readonly kind: "check" }
  | { readonly kind: "install"; readonly version?: string }
  | { readonly kind: "models" } {
  if (args.length === 0) return { kind: "install" };

  if (args.length === 1 && args[0] === "--check") return { kind: "check" };

  if (args.length === 1 && args[0] === "--models") return { kind: "models" };
  const version = args[0];

  if (
    args.length === 1 &&
    version !== undefined &&
    /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)
  )
    return { kind: "install", version };
  throw new Error("Usage: nyte update [<version> | --check | --models]. Run `nyte update --help`.");
}
