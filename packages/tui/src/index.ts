import process from "node:process";
import type { Connection } from "@nyte-ai/sdk";
import { accountCommand } from "./account-command.ts";
import { apiCommand } from "./api-command.ts";
import { COMMANDS } from "./cli/commands.ts";
import type { CommandName } from "./cli/commands.ts";
import { CliError, shellCommand, suggest } from "./cli/errors.ts";
import { renderHelp } from "./cli/help.ts";
import { createInvocation } from "./cli/invocation.ts";
import type { CommandEnd, Invocation } from "./cli/invocation.ts";
import { resolveMode } from "./cli/mode.ts";
import { createOutput } from "./cli/output.ts";
import type { Output } from "./cli/output.ts";
import { route } from "./cli/route.ts";
import type { Route } from "./cli/route.ts";
import { eventsCommand } from "./events-command.ts";
import { connectHostSocket } from "./host-socket.ts";
import { doctorCommand } from "./doctor-command.ts";
import { mcpCommand } from "./mcp-command.ts";
import { skillCommand } from "./skill-command.ts";
import { triageCommand } from "./triage-command.ts";
import { trustCommand, untrustCommand } from "./trust-command.ts";
import { availableModels } from "./lib/catalog.ts";
import { misplacedCommand, parseFlags, readPrompt, readStdin, resolveTuiResume } from "./flags.ts";
import type { RunFlags } from "./flags.ts";
import { loginCommand, logoutCommand } from "./login-command.ts";
import { statusCommand } from "./status-command.ts";
import { updateCommand } from "./update-command.ts";
import { VERSION } from "./version.ts";
import { addFolder, flagConfiguration, targetSession, trustFolder } from "./run.ts";
import { hostCommand } from "./host-command.ts";
import { connectHost } from "./local-host.ts";
import { openLiveHost } from "./live-host.ts";
import type { HostSource } from "./local-host.ts";
import { printRun } from "./print.ts";
import { runTui } from "./app/main.tsx";

interface Context {
  readonly output: Output;
  readonly invocation: Invocation;
}

type Handler = (args: readonly string[], context: Context) => Promise<CommandEnd>;

const HANDLERS: Record<CommandName, Handler> = {
  trust: async (args, context) => {
    await trustCommand({
      args,
      output: context.output,
      signal: context.invocation.signal,
      connection: () => openHost(context),
    });

    return { kind: "exit", code: 0 };
  },
  untrust: async (args, context) => {
    await untrustCommand({
      args,
      output: context.output,
      signal: context.invocation.signal,
      connection: () => openHost(context),
    });

    return { kind: "exit", code: 0 };
  },
  login: async (args, context) => {
    await loginCommand({
      args,
      output: context.output,
      signal: context.invocation.signal,
      connection: () => openHost(context),
    });

    return { kind: "exit", code: 0 };
  },
  logout: async (args, context) => {
    await logoutCommand({
      args,
      output: context.output,
      signal: context.invocation.signal,
      connection: () => openHost(context),
    });

    return { kind: "exit", code: 0 };
  },
  status: async (args, context) => {
    await statusCommand({
      args,
      output: context.output,
      signal: context.invocation.signal,
      attach: (endpoint) => openHost(context, { kind: "attached", endpoint }),
    });

    return { kind: "exit", code: 0 };
  },
  update: async (args, context) => {
    await updateCommand({
      args,
      output: context.output,
      signal: context.invocation.signal,
      connection: () => openHost(context),
    });

    return { kind: "exit", code: 0 };
  },
  account: async (args, context) => ({
    kind: "exit",
    code: await accountCommand(args, {
      output: context.output,
      signal: context.invocation.signal,
    }),
  }),
  mcp: async (args, context) => ({
    kind: "exit",
    code: await mcpCommand({
      args,
      connect: (source) => openHost(context, source),
      signal: context.invocation.signal,
      output: context.output,
    }),
  }),
  api: async (args, context) => ({
    kind: "exit",
    code: await apiCommand({
      args,
      attach: (url) => openHost(context, attachedSource(url)),
      connect: (hostUrl) =>
        connectHostSocket({
          source: hostUrl === undefined ? { kind: "local" } : attachedSource(hostUrl),
          name: "nyte api",
        }),
      stdin: () => readStdin(context.output.mode.tty.stdin, context.invocation.signal),
      output: context.output,
      width: process.stdout.columns ?? 80,
    }),
  }),
  skill: async (args, context) => ({
    kind: "exit",
    code: await skillCommand({ args, env: process.env, output: context.output }),
  }),
  host: async (args, context) => ({
    kind: "exit",
    code: await hostCommand(args, context.invocation.signal, context.output),
  }),
  events: async (args, context) => ({
    kind: "exit",
    code: await eventsCommand({
      args,
      dialer: (hostUrl) => {
        const source: HostSource =
          hostUrl === undefined ? { kind: "local" } : attachedSource(hostUrl);

        return () => connectHostSocket({ source, name: "nyte events" });
      },
      signal: context.invocation.signal,
      output: context.output,
    }),
  }),
  doctor: async (args, context) => ({
    kind: "exit",
    code: await doctorCommand(args, context.output),
  }),
  triage: async (args, context) => ({ kind: "exit", code: await triageCommand(args, context) }),
};

const argv = process.argv.slice(2);

const where = route(argv);

const json =
  where.kind === "command" || where.kind === "chat" || where.kind === "version"
    ? where.json
    : false;

const mode = resolveMode(process, json);

const output = createOutput(mode, process);

const invocation = createInvocation(output);

const end = await run(where, { output, invocation }).catch((error: unknown): CommandEnd => ({
  kind: "error",
  error,
}));

process.exitCode = await invocation.finish(end, json);

async function run(target: Route, context: Context): Promise<CommandEnd> {
  switch (target.kind) {
    case "help":
      context.output.result(
        `${renderHelp(target.path, context.output.mode.stdout, process.stdout.columns ?? 80)}\n`,
      );

      return { kind: "exit", code: 0 };
    case "version":
      if (target.json) context.output.json({ version: VERSION });
      else context.output.result(`${VERSION}\n`);

      return { kind: "exit", code: 0 };
    case "unknown":
      throw unknownCommand(target.word);
    case "chat":
      return chat(target.args, context);
    case "command":
      return HANDLERS[target.name](target.args, context);
    default: {
      const _exhaustive: never = target;

      return _exhaustive;
    }
  }
}

function unknownCommand(word: string): CliError {
  const near = suggest(
    word,
    COMMANDS.map((command) => command.name),
  );

  return new CliError(
    "unknown_command",
    `Unknown command ${word} for nyte.${near === undefined ? "" : ` Did you mean ${near}?`}`,
    { next: [{ label: "See all commands", argv: ["nyte", "--help"] }] },
  );
}

async function openHost(
  context: Context,
  source: HostSource = { kind: "local" },
): Promise<Connection> {
  const host = await connectHost(source, (phase) => context.output.progress(phase));
  context.invocation.defer(() => host.close());

  return host.connection;
}

/** `--host-url` attaches to that host with the token in `NYTE_HOST_TOKEN`, which leaves the environment so nothing this process starts inherits it. */
function hostSource(flags: RunFlags): HostSource {
  return flags.hostUrl === undefined ? { kind: "local" } : attachedSource(flags.hostUrl);
}

function attachedSource(url: string): HostSource {
  const token = process.env["NYTE_HOST_TOKEN"];
  delete process.env["NYTE_HOST_TOKEN"];

  if (token === undefined || token === "")
    throw new CliError("missing_input", "Can't attach to --host-url without NYTE_HOST_TOKEN set.", {
      details: [{ label: "Token", value: "nyte host writes it to ~/.nyte/host.json" }],
    });

  return { kind: "attached", endpoint: { url, token } };
}

/** The TUI, or one prompt with `-p`. Every argv mistake fails here, before any host work. */
async function chat(args: readonly string[], context: Context): Promise<CommandEnd> {
  const misplaced = misplacedCommand(
    args,
    COMMANDS.map((command) => command.name),
  );

  if (misplaced !== undefined)
    throw new CliError(
      "invalid_arguments",
      `Put ${misplaced[0] ?? ""} first: ${shellCommand(["nyte", ...misplaced])}`,
    );

  const flags = parseFlags(args);
  const stdinTerminal = context.output.mode.tty.stdin;
  const stdoutTerminal = context.output.mode.tty.stdout;
  const tui = !flags.print && !flags.json && !flags.quiet && stdinTerminal;
  const resumeId = flags.resume.kind === "latest" && flags.rest.length === 1;

  if (!flags.print && flags.rest.length > 0 && !(tui && resumeId))
    throw unknownCommand(flags.rest[0] ?? "");
  const source = hostSource(flags);

  if (flags.minimal && (!stdinTerminal || !stdoutTerminal))
    throw new CliError(
      "missing_input",
      "Can't open --minimal without a terminal on stdin and stdout.",
      {
        next: [
          { label: "Run it in a terminal without pipes or redirects", argv: ["nyte", "--minimal"] },
        ],
      },
    );

  if (!tui)
    return print(
      flags,
      await readPrompt(flags.rest, stdinTerminal, context.invocation.signal),
      source,
      context,
    );

  if (!stdoutTerminal)
    throw new CliError(
      "missing_input",
      "Can't open the full-screen app without a terminal on stdout.",
      {
        next: [{ label: "Send one prompt and print the answer", argv: ["nyte", "-p", "<PROMPT>"] }],
      },
    );

  context.invocation.signal.throwIfAborted();
  context.invocation.handoff();

  return process.exit(await runTui(resolveTuiResume(flags), source));
}

/** One prompt. Everything the flags name is checked before the first change: trust, model settings or the send. */
async function print(
  flags: RunFlags,
  prompt: string,
  source: HostSource,
  context: Context,
): Promise<CommandEnd> {
  const signal = context.invocation.signal;
  const out = context.output;

  const stopIfCanceled = (): void => {
    if (signal.aborted) throw new CliError("canceled", "Canceled.");
  };

  stopIfCanceled();
  const local = await connectHost(source, (phase) => out.progress(phase));
  context.invocation.defer(() => local.close());
  const host = local.connection;
  const live = openLiveHost(local.endpoint, "cli");
  context.invocation.defer(() => live.release());
  stopIfCanceled();
  const catalog = await host.models.list();

  if (availableModels(catalog).length === 0)
    throw new CliError("missing_input", "Can't send a prompt without a stored credential.", {
      next: [{ label: "Sign in to a provider", argv: ["nyte", "login"] }],
    });
  const configuration = flagConfiguration(catalog, flags);
  const resumed = await targetSession(host, flags.resume);

  if (flags.resume.kind === "latest" && resumed === null)
    throw new CliError("not_found", "Can't continue the latest chat. There are no chats yet.", {
      next: [{ label: "Start a chat", argv: ["nyte", "-p", "<PROMPT>"] }],
    });

  if (flags.trust !== undefined) await trustFolder(host, flags.resume, process.cwd(), flags.trust);

  if (resumed !== null && flags.resume.kind === "latest" && !flags.json) {
    const workspace = await host.workspace((await resumed.info()).workspace).info();

    out.rows([
      { label: "Continuing", value: resumed.id },
      {
        label: "Folder",
        value: "path" in workspace.target ? workspace.target.path : workspace.id,
      },
    ]);
    out.say("");
  }

  stopIfCanceled();

  if (resumed !== null && configuration !== undefined) {
    const configured = await resumed.configure(configuration);

    if (configured.kind !== "configured")
      throw new CliError("failed", "Couldn't apply --model or --effort to the chat.", {
        details: [
          { label: "Session", value: resumed.id },
          { label: "Outcome", value: configured.kind },
        ],
      });
  }

  const started =
    resumed === null
      ? await host.sessions.start({
          workspace: await addFolder(host, process.cwd()),
          content: prompt,
          contextFiles: flags.contextFiles,
          configuration,
        })
      : { session: resumed, receipt: await resumed.send(prompt) };

  await printRun({
    session: started.session,
    live,
    receipt: started.receipt,
    json: flags.json,
    quiet: flags.quiet,
    output: out,
    signal,
  });

  return { kind: "exit", code: 0 };
}
