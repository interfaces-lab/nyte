import process from "node:process";
import { WorkspaceTrustRequired } from "@nyte-ai/core";
import {
  alignedRows,
  ansiEnabled,
  bold,
  dim,
  renderHelp,
  statusGlyph,
  updateSeverity,
} from "./cli-style.ts";
import { parseFlags, readStdin, resolveTuiResume, wantsPrint } from "./flags.ts";
import type { RunFlags } from "./flags.ts";
import type { UpdateProgress } from "./update.ts";
import { VERSION } from "./version.ts";

async function login(id: string | undefined): Promise<void> {
  const [{ createNyteModels }, { DEFAULT_PROVIDER_ID, loadProviderCatalog, requireProvider }] =
    await Promise.all([import("@nyte-ai/ai"), import("./catalog.ts")]);
  const { cliInteraction } = await import("./interaction.ts");
  const models = createNyteModels();
  const provider = requireProvider(models, id ?? DEFAULT_PROVIDER_ID);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const interaction = cliInteraction(controller.signal);
  const { oauth, apiKey } = provider.auth;
  let mode: "oauth" | "api_key" = oauth !== undefined ? "oauth" : "api_key";
  if (oauth !== undefined && apiKey?.login !== undefined) {
    const picked = await interaction.prompt({
      type: "select",
      message: `Select ${provider.name} login mode:`,
      options: [
        { id: "oauth", label: oauth.name },
        { id: "api_key", label: apiKey.name },
      ],
    });
    if (picked !== "oauth" && picked !== "api_key") throw new Error("Invalid login method");
    mode = picked;
  }
  await models.login(provider.id, mode, interaction);
  await loadProviderCatalog(models, provider.id);
  console.log(`${statusGlyph("ok", ansiEnabled())} Logged in to ${provider.name}.`);
  console.log(`  ${dim("run `nyte` to start")}`);
}

async function logout(id: string | undefined): Promise<void> {
  const [{ createNyteModels }, { DEFAULT_PROVIDER_ID, requireProvider }] = await Promise.all([
    import("@nyte-ai/ai"),
    import("./catalog.ts"),
  ]);
  const models = createNyteModels();
  const provider = requireProvider(models, id ?? DEFAULT_PROVIDER_ID);
  await models.logout(provider.id);
  console.log(`${statusGlyph("ok", ansiEnabled())} Logged out of ${provider.name}.`);
}

async function update(args: readonly string[]): Promise<void> {
  const { checkForUpdate } = await import("./version.ts");
  const { describeUpdateOutcome, selfUpdate } = await import("./update.ts");
  const tty = ansiEnabled();
  if (args.includes("--check")) {
    const notice = await checkForUpdate();
    console.log(
      notice === undefined
        ? `nyte ${VERSION} is the latest release.`
        : `Update available: ${notice.version}. Run: nyte update`,
    );
    return;
  }
  const version = args.find((arg) => !arg.startsWith("-"));
  console.log(`${bold("nyte")} ${dim(`${VERSION} → ${version ?? "latest"}`)}`);

  // On a terminal the percent rows overwrite one line; piped, they stay
  // discrete lines a log can read.
  let progressOpen = false;
  const endProgress = (): void => {
    if (!progressOpen) return;
    process.stdout.write("\n");
    progressOpen = false;
  };
  const report = (event: UpdateProgress): void => {
    switch (event.kind) {
      case "downloading":
        console.log(dim(`downloading ${event.asset}`));
        return;
      case "percent": {
        const row = `  ${String(event.percent)}%`;
        if (!tty) {
          console.log(row);
          return;
        }
        process.stdout.write(`\r\x1b[K${row}`);
        progressOpen = true;
        return;
      }
      case "verified":
        endProgress();
        console.log(`${statusGlyph("ok", tty)} ${dim("checksum verified")}`);
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
  console.log(`${statusGlyph(severity, tty)} ${describeUpdateOutcome(outcome)}`);
  if (severity !== "ok") process.exitCode = 1;
}

async function status(): Promise<void> {
  const { FileCredentialStore } = await import("@nyte-ai/ai");
  const stored = await new FileCredentialStore().list();
  if (stored.length === 0) {
    console.log(dim("no stored credentials"));
    return;
  }
  const rows = stored.map((info) => ({ label: info.providerId, detail: info.type }));
  for (const row of alignedRows(rows, ansiEnabled())) console.log(row);
}

async function print(flags: RunFlags): Promise<void> {
  const { createWorkspaceTrustStore } = await import("./workspace-trust.ts");
  const { FileSettingsStore } = await import("./settings.ts");
  const { hostFallbacks, openWorkspaceHost, resolveRuntime, targetSession } =
    await import("./run.ts");
  const { printRun, reportPrintOutcome } = await import("./print.ts");

  const workspace = await createWorkspaceTrustStore()
    .require(process.cwd())
    .catch((cause: unknown) => {
      if (cause instanceof WorkspaceTrustRequired) {
        throw new Error(
          `Workspace is not trusted: ${cause.cwd}. Run \`nyte\` interactively to trust it first.`,
        );
      }
      throw cause;
    });
  const settingsStore = new FileSettingsStore();
  const settings = await settingsStore.read(workspace.cwd);
  const runtime = await resolveRuntime(flags, settings);
  if (runtime === undefined)
    throw new Error("Couldn't find a stored credential. Run `nyte login`.");
  const { model, thinkingLevel } = hostFallbacks(runtime, settings, flags);
  const host = await openWorkspaceHost({
    workspace,
    settings,
    runtime,
    model,
    thinkingLevel,
    report: (message) => process.stderr.write(`${message}\n`),
  });
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  const detach = host.attach();
  try {
    const target = await targetSession(host.nyte, flags.resume);
    controller.signal.addEventListener(
      "abort",
      () => void host.nyte.runs.abort({ sessionId: target.sessionId }).catch(() => undefined),
      { once: true },
    );
    const output = {
      write: (text: string): void => void process.stdout.write(text),
      error: (text: string): void => void process.stderr.write(`${text}\n`),
    };
    // Record explicit CLI choices together; settings-derived defaults stay fallbacks.
    const modelConfig =
      flags.model !== undefined || process.env["NYTE_MODEL"] !== undefined
        ? { model: { provider: model.provider, id: model.id } }
        : undefined;
    const configure = flags.effort === undefined ? modelConfig : { ...modelConfig, thinkingLevel };
    const input = {
      nyte: host.nyte,
      sessionId: target.sessionId,
      content: flags.rest.join(" "),
      json: flags.json,
      quiet: flags.quiet,
      output,
      signal: controller.signal,
    };
    const outcome = await printRun(configure === undefined ? input : { ...input, configure });
    if (outcome.kind === "completed") {
      void settingsStore.updateGlobal({
        defaultProvider: runtime.provider.id,
        defaultModel: model.id,
        defaultThinkingLevel: thinkingLevel,
      });
    }
    process.exitCode = reportPrintOutcome(outcome, {
      sessionId: target.sessionId,
      json: flags.json,
      output,
    });
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    detach();
    await host.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(renderHelp());
    return;
  }
  if (command === "login") {
    await login(args[1]);
    return;
  }
  if (command === "logout") {
    await logout(args[1]);
    return;
  }
  if (command === "status") {
    await status();
    return;
  }
  if (command === "update") {
    await update(args.slice(1));
    return;
  }

  let flags = parseFlags(args);
  if (wantsPrint(flags, Boolean(process.stdout.isTTY), Boolean(process.stdin.isTTY))) {
    if (flags.rest.length === 0) {
      const stdin = await readStdin();
      if (stdin === "") {
        console.error(renderHelp(false));
        process.exitCode = 1;
        return;
      }
      flags = { ...flags, rest: [stdin] };
    }
    await print(flags);
    return;
  }
  if (!process.stdout.isTTY) {
    console.error(renderHelp(false));
    process.exitCode = 1;
    return;
  }
  const { runTui } = await import("./interactive.ts");
  const exit = await runTui(resolveTuiResume(flags));
  if (exit.kind === "signal") process.kill(process.pid, exit.signal);
  // Bun's watch mode stays alive when main returns, even after the TUI closes.
  else process.exit(0);
}

try {
  await main();
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const tty = ansiEnabled();
  console.error(tty ? `${statusGlyph("fail", tty)} ${message}` : message);
  process.exitCode = 1;
}
