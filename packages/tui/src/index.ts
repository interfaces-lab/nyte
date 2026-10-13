import process from "node:process";
import type { Host, LoginMethod } from "@nyte-ai/sdk";
import { loginProvider, logoutProvider } from "./services/auth.ts";
import { availableModels } from "./lib/catalog.ts";
import {
  alignedRows,
  ansiEnabled,
  bold,
  dim,
  renderHelp,
  renderCommandHelp,
  statusGlyph,
  updateSeverity,
} from "./cli-style.ts";
import { parseFlags, parseUpdateArgs, readStdin, resolveTuiResume, wantsPrint } from "./flags.ts";
import type { RunFlags } from "./flags.ts";
import { openTerminalHost } from "./host.ts";
import { cliLoginDriver } from "./interaction.ts";
import type { UpdateProgress } from "./update.ts";
import { VERSION, checkForUpdate } from "./version.ts";
import { describeUpdateOutcome, selfUpdate } from "./update.ts";
import { flagConfiguration, targetSession } from "./run.ts";
import { printRun } from "./print.ts";
import type { PrintOutcome } from "./print.ts";
import { PrintInvocation } from "./print-invocation.ts";
import { runTui } from "./app/main.tsx";

const invocationArgs = process.argv.slice(2);

const json = invocationArgs
  .slice(0, invocationArgs.indexOf("--") < 0 ? invocationArgs.length : invocationArgs.indexOf("--"))
  .includes("--json");

const output = {
  write: (text: string): void => void process.stdout.write(text),
  error: (text: string): void => void process.stderr.write(`${text}\n`),
};

const invocation = new PrintInvocation({ json, output });

const signal = invocation.controller.signal;

/** Opens the host for this folder; the invocation closes it. */
async function openHost(): Promise<Host> {
  const host = await openTerminalHost();
  invocation.defer(() => host.close());

  return host;
}

function parseAuthArgs(command: "login" | "logout", args: readonly string[]) {
  let providerId: string | undefined;
  let method: LoginMethod["kind"] | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (command === "login" && (arg === "--method" || arg.startsWith("--method="))) {
      if (method !== undefined) throw new Error("Provide --method only once.");
      const value = arg === "--method" ? args[++index] : arg.slice("--method=".length);

      if (value !== "oauth" && value !== "api_key") {
        throw new Error("--method must be oauth or api_key. Run `nyte login --help`.");
      }

      method = value === "oauth" ? "oauth" : "key";
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown ${command} option: ${arg}. Run \`nyte ${command} --help\`.`);
    }

    if (providerId !== undefined || arg.trim() === "") {
      throw new Error(`Provide one provider argument. Run \`nyte ${command} --help\`.`);
    }

    providerId = arg;
  }

  if (providerId === undefined && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    throw new Error(
      `A provider argument is required without an interactive terminal. Run \`nyte ${command} <provider>\`.`,
    );
  }

  return { providerId, method };
}

async function authenticate(command: "login" | "logout", args: readonly string[]): Promise<void> {
  const options = parseAuthArgs(command, args);

  if (command === "login" && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    const argv = [
      "nyte",
      "login",
      ...(options.providerId === undefined ? [] : [options.providerId]),
      ...(options.method === undefined
        ? []
        : ["--method", options.method === "key" ? "api_key" : "oauth"]),
    ];

    const commandLine = argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
    throw new Error(
      `Login requires an interactive terminal on stdin and stderr. Run ${commandLine} in a terminal.`,
    );
  }

  signal.throwIfAborted();
  const host = await openHost();

  const driver = cliLoginDriver(signal, () => {
    process.emit("SIGINT");
  });

  if (command === "logout") {
    const result = await logoutProvider({
      connection: host,
      driver,
      providerId: options.providerId,
    });
    console.log(`${statusGlyph("ok", ansiEnabled())} ${result.message}`);

    return;
  }

  const provider = await loginProvider({
    connection: host,
    driver,
    providerId: options.providerId,
    method: options.method,
  });

  console.log(`${statusGlyph("ok", ansiEnabled())} Logged in to ${provider.name}.`);

  try {
    await host.models.refresh(provider.id);
  } catch {
    signal.throwIfAborted();
    console.error("Login is saved, but the model catalog failed to reload.");
  }

  console.log("  run `nyte` to start");
}

async function update(args: readonly string[]): Promise<void> {
  const options = parseUpdateArgs(args);

  if (options.kind === "models") {
    const host = await openHost();
    await host.models.refresh();
    signal.throwIfAborted();
    const color = ansiEnabled();

    for (const provider of (await host.models.list()).providers) {
      console.log(
        provider.credential === "failed"
          ? `${statusGlyph("fail", color)} ${provider.id}  credential failed`
          : `${statusGlyph("ok", color)} ${provider.id}  ${String(provider.models.length)} models`,
      );
    }

    return;
  }

  const tty = ansiEnabled(process.stderr);

  if (options.kind === "check") {
    const notice = await checkForUpdate();
    console.log(
      notice === undefined
        ? `nyte ${VERSION} is the latest release.`
        : `Update available: ${notice.version}. Run: nyte update`,
    );

    return;
  }

  const version = options.version;
  console.error(`${bold("nyte", tty)} ${dim(`${VERSION} → ${version ?? "latest"}`, tty)}`);

  // On a terminal the percent rows overwrite one line; piped, they stay
  // discrete lines a log can read.
  let progressOpen = false;

  const endProgress = (): void => {
    if (!progressOpen) return;
    process.stderr.write("\n");
    progressOpen = false;
  };

  const report = (event: UpdateProgress): void => {
    switch (event.kind) {
      case "downloading":
        console.error(dim(`downloading ${event.asset}`, tty));

        return;
      case "percent": {
        const row = `  ${String(event.percent)}%`;

        if (!tty) {
          console.error(row);

          return;
        }

        process.stderr.write(`\r\x1b[K${row}`);
        progressOpen = true;

        return;
      }

      case "verified":
        endProgress();
        console.error(`${statusGlyph("ok", tty)} ${dim("checksum verified", tty)}`);

        return;
      default: {
        const _exhaustive: never = event;

        return _exhaustive;
      }
    }
  };

  const outcome = await selfUpdate(version === undefined ? { report } : { version, report });
  endProgress();

  const severity = updateSeverity(outcome);
  console.log(`${statusGlyph(severity, ansiEnabled())} ${describeUpdateOutcome(outcome)}`);

  if (severity !== "ok") process.exitCode = 1;
}

async function status(): Promise<void> {
  const host = await openHost();

  const stored = (await host.models.list()).providers.filter(
    (provider) => provider.credential !== "missing",
  );

  if (json) {
    output.write(
      `${JSON.stringify({
        type: "status",
        credentials: stored.map((provider) => ({
          provider: provider.id,
          credential: provider.credential,
        })),
      })}\n`,
    );

    return;
  }

  if (stored.length === 0) {
    console.log(dim("no stored credentials"));

    return;
  }

  const rows = stored.map((provider) => ({ label: provider.id, detail: provider.credential }));

  for (const row of alignedRows(rows, ansiEnabled())) console.log(row);
}

async function print(flags: RunFlags): Promise<PrintOutcome> {
  signal.throwIfAborted();
  const host = await openHost();
  signal.throwIfAborted();

  if (availableModels(await host.models.list()).length === 0)
    throw new Error("Couldn't find a stored credential. Run `nyte login`.");
  const configuration = await flagConfiguration(host, flags);

  if (configuration?.model !== undefined) {
    const set = await host.models.setDefault(configuration.model);

    if (set.kind === "unknown-model")
      throw new Error(
        `Unavailable model: ${configuration.model.provider}/${configuration.model.id}`,
      );
  }

  const session = await targetSession(host, flags.resume, undefined);
  invocation.sessionId = session.id;
  signal.throwIfAborted();

  return printRun({
    session,
    content: flags.rest.join(" "),
    json: flags.json,
    quiet: flags.quiet,
    output,
    signal,
    configuration,
  });
}

async function main(): Promise<PrintOutcome | undefined> {
  signal.throwIfAborted();
  const command = invocationArgs[0];

  if (command === "--version" || command === "-v") {
    if (invocationArgs.length !== 1) throw new Error("Usage: nyte --version");
    process.stdout.write(`${VERSION}\n`);

    return undefined;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    if (invocationArgs.length !== 1) throw new Error("Usage: nyte --help");
    console.log(renderHelp());

    return undefined;
  }

  if (command === "login" || command === "logout" || command === "status" || command === "update") {
    if (invocationArgs.slice(1).some((arg) => arg === "--help" || arg === "-h")) {
      if (invocationArgs.length !== 2) throw new Error(`Use nyte ${command} --help on its own.`);
      console.log(renderCommandHelp(command));

      return undefined;
    }
  }

  if (command === "login" || command === "logout") {
    await authenticate(command, invocationArgs.slice(1));

    return undefined;
  }

  if (command === "status") {
    if (invocationArgs.slice(1).some((arg) => arg !== "--json") || invocationArgs.length > 2) {
      throw new Error("Usage: nyte status [--json]");
    }

    await status();

    return json ? { kind: "completed" } : undefined;
  }

  if (command === "update") {
    await update(invocationArgs.slice(1));

    return undefined;
  }

  let flags = parseFlags(invocationArgs);

  if (wantsPrint(flags, Boolean(process.stdout.isTTY), Boolean(process.stdin.isTTY))) {
    if (flags.rest.length === 0) {
      const stdin = await readStdin(signal);

      if (stdin === "") {
        return {
          kind: "failed",
          code: "input_empty",
          message: "Provide a prompt or non-empty stdin. Run `nyte --help`.",
        };
      }

      flags = { ...flags, rest: [stdin] };
    }

    return print(flags);
  }

  if (!process.stdout.isTTY) {
    console.error(renderHelp(false));
    process.exitCode = 1;

    return undefined;
  }

  signal.throwIfAborted();
  invocation.handoff();
  const exit = await runTui(resolveTuiResume(flags));

  if (exit.kind === "signal") process.kill(process.pid, exit.signal);
  // Bun's watch mode stays alive when main returns, even after the TUI closes.
  else process.exit(0);

  return undefined;
}

let outcome: PrintOutcome | undefined;

try {
  outcome = await main();
} catch (cause) {
  outcome = {
    kind: "failed",
    code: "startup_failed",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

const exitCode = await invocation.finish(outcome);

if (exitCode !== undefined) process.exitCode = exitCode;
