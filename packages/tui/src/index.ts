import process from "node:process";
import { createNyteModels, FileCredentialStore } from "@nyte-ai/ai";
import type { AuthType } from "@nyte-ai/ai";
import type { TrustedWorkspace } from "@nyte-ai/core";
import { createWorkspaceStore, WorkspaceTrustRequired } from "@nyte-ai/host";
import { createOtelExport } from "@nyte-ai/host/otel";
import { loginProvider, logoutProvider } from "./auth.ts";
import { loadAuthenticatedModels, requireProvider } from "./catalog.ts";
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
import { cliInteraction } from "./interaction.ts";
import type { UpdateProgress } from "./update.ts";
import { VERSION, checkForUpdate } from "./version.ts";
import { describeUpdateOutcome, selfUpdate } from "./update.ts";
import { FileSettingsStore } from "./settings.ts";
import { hostFallbacks, openWorkspaceHost, resolveRuntime, targetSession } from "./run.ts";
import { printRun } from "./print.ts";
import type { PrintOutcome } from "./print.ts";
import { PrintInvocation } from "./print-invocation.ts";
import { runTui } from "./interactive.ts";

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

function parseAuthArgs(command: "login" | "logout", args: readonly string[]) {
  let providerId: string | undefined;
  let method: AuthType | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (command === "login" && (arg === "--method" || arg.startsWith("--method="))) {
      if (method !== undefined) throw new Error("Provide --method only once.");
      const value = arg === "--method" ? args[++index] : arg.slice("--method=".length);

      if (value !== "oauth" && value !== "api_key") {
        throw new Error("--method must be oauth or api_key. Run `nyte login --help`.");
      }

      method = value;
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
  const models = createNyteModels();

  if (options.providerId !== undefined) {
    const provider = requireProvider(models, options.providerId);

    if (command === "login" && options.method !== undefined) {
      const method = options.method === "oauth" ? provider.auth.oauth : provider.auth.apiKey;

      if (method?.login === undefined)
        throw new Error(`Unsupported login method for ${provider.name}: ${options.method}`);
    }
  }

  if (command === "login" && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    const argv = [
      "nyte",
      "login",
      ...(options.providerId === undefined ? [] : [options.providerId]),
      ...(options.method === undefined ? [] : ["--method", options.method]),
    ];

    const commandLine = argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
    throw new Error(
      `Login requires an interactive terminal on stdin and stderr. Run ${commandLine} in a terminal.`,
    );
  }

  signal.throwIfAborted();

  const interaction = cliInteraction(signal, () => {
    process.emit("SIGINT");
  });

  if (command === "logout") {
    const result = await logoutProvider({ models, interaction, providerId: options.providerId });
    console.log(`${statusGlyph("ok", ansiEnabled())} ${result.message}`);

    return;
  }

  const provider = await loginProvider({ models, interaction, ...options });
  console.log(`${statusGlyph("ok", ansiEnabled())} Logged in to ${provider.name}.`);

  try {
    // Refresh dynamic catalogs after saving auth. Copilot resolves its account
    // model IDs during login and uses generated definitions without this step.
    const refreshed = await models.refresh({ providers: [provider.id], force: true, signal });

    for (const error of refreshed.errors.values()) {
      console.error(`Login is saved, but model discovery failed: ${error.message}`);
    }

    await loadAuthenticatedModels(models, { force: true, allowNetwork: false, signal });
  } catch {
    signal.throwIfAborted();
    console.error("Login is saved, but the model catalog failed to reload.");
  }

  console.log("  run `nyte` to start");
}

async function update(args: readonly string[]): Promise<void> {
  const options = parseUpdateArgs(args);

  if (options.kind === "models") {
    const models = createNyteModels();
    const refreshed = await models.refresh({ force: true, signal });
    signal.throwIfAborted();
    const color = ansiEnabled();

    for (const provider of models.getProviders()) {
      const error = refreshed.errors.get(provider.id);

      if (error === undefined) {
        console.log(
          `${statusGlyph("ok", color)} ${provider.id}  ${String(models.getModels(provider.id).length)} models`,
        );
      } else {
        console.log(`${statusGlyph("fail", color)} ${provider.id}  ${error.message}`);
      }
    }

    if (refreshed.errors.size > 0) process.exitCode = 1;

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
  const stored = await new FileCredentialStore().list();

  if (json) {
    output.write(
      `${JSON.stringify({
        type: "status",
        credentials: stored.map((info) => ({ provider: info.providerId, method: info.type })),
      })}\n`,
    );

    return;
  }

  if (stored.length === 0) {
    console.log(dim("no stored credentials"));

    return;
  }

  const rows = stored.map((info) => ({ label: info.providerId, detail: info.type }));

  for (const row of alignedRows(rows, ansiEnabled())) console.log(row);
}

async function print(flags: RunFlags): Promise<PrintOutcome> {
  signal.throwIfAborted();
  let workspace: TrustedWorkspace;

  try {
    workspace = await createWorkspaceStore().require(process.cwd());
  } catch (cause) {
    if (cause instanceof WorkspaceTrustRequired) {
      throw new Error(
        `Workspace is not trusted: ${cause.cwd}. Run \`nyte\` interactively to trust it first.`,
        { cause },
      );
    }

    throw cause;
  }

  signal.throwIfAborted();
  const settingsStore = new FileSettingsStore();
  const settings = await settingsStore.read(workspace.cwd);
  signal.throwIfAborted();
  const runtime = await resolveRuntime(flags, settings);
  signal.throwIfAborted();

  if (runtime === undefined)
    throw new Error("Couldn't find a stored credential. Run `nyte login`.");
  const { model, thinkingLevel } = hostFallbacks(runtime, settings, flags);
  const otel = createOtelExport({ serviceName: "nyte-tui" });
  invocation.defer(() => otel.shutdown());

  const host = await openWorkspaceHost({
    workspace,
    settings,
    runtime,
    model,
    thinkingLevel,
    telemetry: otel.telemetry,
    report: output.error,
  });

  invocation.defer(() => host.close());
  signal.throwIfAborted();
  const target = await targetSession(host.nyte, flags.resume);
  invocation.sessionId = target.sessionId;
  signal.throwIfAborted();
  invocation.defer(host.attach(target.sessionId));

  const modelConfig =
    flags.model !== undefined || process.env["NYTE_MODEL"] !== undefined
      ? { model: { provider: model.provider, id: model.id } }
      : undefined;

  const configure = flags.effort === undefined ? modelConfig : { ...modelConfig, thinkingLevel };

  const outcome = await printRun({
    nyte: host.nyte,
    sessionId: target.sessionId,
    content: flags.rest.join(" "),
    json: flags.json,
    quiet: flags.quiet,
    output,
    signal,
    configure,
  });

  if (outcome.kind === "completed") {
    await settingsStore.updateGlobal({
      defaultProvider: runtime.provider.id,
      defaultModel: model.id,
      defaultThinkingLevel: thinkingLevel,
    });
  }

  return outcome;
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
