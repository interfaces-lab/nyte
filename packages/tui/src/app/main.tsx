import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { CliRenderer, NativeSession } from "@opentui/core";
import type { BootOptions } from "../effects/boot.ts";
import { installProcessHooks, openCrashLog } from "../effects/crash.ts";
import { createHandle, filesPort, settingsPort, shellPort } from "../effects/local-ports.ts";
import { terminalPort } from "../effects/terminal-port.ts";
import { sessionRecovery } from "../flags.ts";
import type { RunFlags } from "../flags.ts";
import { exitStatus, exitWithin, onEnding, watchTerminal } from "../lifecycle.ts";
import type { Ending } from "../lifecycle.ts";
import { trustFolder } from "../run.ts";
import { connectLocalHost } from "../local-host.ts";
import type { FailureReport } from "../model/state.ts";
import { firstFramePort } from "../services/first-frame.ts";
import { TUI_RENDERER_CONFIG } from "../services/rendering.ts";
import { registerSyntaxParsers } from "../services/syntax-parsers.ts";
import { createKeymap } from "./keyboard.ts";
import { mountApp } from "./mount.tsx";
import { holdTypeahead } from "./typeahead.ts";

export async function runTui(flags: RunFlags): Promise<number> {
  const connecting = connectLocalHost();
  connecting.catch(() => undefined);
  const cwd = process.cwd();
  const home = process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");
  const log = openCrashLog(home);
  const failures: string[] = [];
  const signalled = Promise.withResolvers<Ending>();

  const stopEnding = onEnding((ending) => {
    exitWithin(exitStatus(ending));
    signalled.resolve(ending);
  });

  const cleanup = async (resource: string, dispose: () => Promise<void>): Promise<void> => {
    try {
      await dispose();
    } catch (cause) {
      failures.push(`${resource} cleanup failed: ${failureText(cause)}`);
    }
  };

  registerSyntaxParsers();
  const native = new NativeSession(process.stdout);

  const renderer = new CliRenderer(
    process.stdin,
    process.stdout,
    process.stdout.columns || 80,
    process.stdout.rows || 24,
    {
      ...TUI_RENDERER_CONFIG,
      nativeSession: native,
      exitOnCtrlC: false,
      autoFocus: false,
      enableMouseMovement: true,
      clearOnShutdown: true,
      openConsoleOnError: false,
    },
  );

  const typeahead = holdTypeahead(renderer);

  await renderer.setupTerminal().catch(async (cause: unknown) => {
    renderer.destroy();
    await renderer.closed.catch(() => undefined);

    throw cause;
  });

  const encoder = new TextEncoder();
  const terminal = terminalPort(renderer, { write: (text) => native.write(encoder.encode(text)) });
  const hungUp = new AbortController();

  const unwatchTerminal = watchTerminal(renderer.stdin, [process.stdout, process.stderr], () =>
    hungUp.abort(),
  );

  const { trust, resume } = flags;

  const host = connecting.then(async (local) => {
    if (trust !== undefined) await trustFolder(local.connection, resume, cwd, trust);

    return { connection: local.connection, endpoint: local.endpoint, folder: cwd };
  });

  const app = await mountApp({
    renderer,
    keymap: createKeymap(renderer),
    cwd,
    typeahead,
    hungUp: hungUp.signal,
    host,
    ports: {
      terminal,
      composer: createHandle(),
      scroll: createHandle(),
      settings: settingsPort(),
      firstFrame: firstFramePort(join(home, "tui-first-frame.json")),
      shell: shellPort(),
      files: filesPort(),
      log,
    },
    boot: { start: "launch", home, cwd, target: bootTarget(flags), ...flagSelection(flags) },
  });

  const unhook = installProcessHooks((origin, error) => app.report(origin, error));

  const lost = connecting.then(
    (local) => local.ended.then((error) => ({ error })),
    () => new Promise<never>(() => undefined),
  );

  const ending = await Promise.race([
    app.closing.then((status) => ({ status })),
    signalled.promise.then((signal) => ({ status: exitStatus(signal) })),
    lost,
  ]);

  const status = "status" in ending ? ending.status : 1;

  if ("error" in ending) failures.push(`error: ${ending.error.message}`);
  stopEnding();
  exitWithin(status);
  const exit = app.exit();
  await cleanup("TUI", () => app.close());
  const startupError = app.startupError();

  if (startupError !== null) failures.unshift(`error: ${startupError}`);

  await cleanup("Host", async () => {
    const local = await connecting.catch(() => null);
    await local?.close();
  });

  unwatchTerminal();
  await cleanup("Clipboard", () => terminal.dispose());
  await cleanup("Terminal", async () => {
    renderer.destroy();
    await renderer.closed;
  });
  unhook();
  process.stdout.write(exitText({ ...exit, failures }));

  return status === 0 && failures.length > 0 ? 1 : status;
}

export function exitText(input: {
  readonly session: SessionId | null;
  readonly unsent: string | null;
  readonly failures: readonly string[];
  readonly crashes: readonly FailureReport[];
}): string {
  const lines = [
    ...input.crashes.map((crash) => `error: ${crash.message} (details in ${crash.logPath})`),
    ...input.failures,
    ...(input.unsent === null ? [] : [`Not sent: ${input.unsent}`]),
    ...(input.session === null
      ? []
      : ["To resume previous session", sessionRecovery(input.session).command]),
  ];

  return lines.length === 0 ? "" : `\n${lines.map((line) => `${line}\n`).join("")}`;
}

function bootTarget(flags: RunFlags): BootOptions["target"] {
  return flags.resume.kind === "session"
    ? { kind: "session", id: asId(flags.resume.id) }
    : flags.resume;
}

function flagSelection(flags: RunFlags): Pick<BootOptions, "model" | "effort"> {
  const requested = flags.model ?? process.env["NYTE_MODEL"] ?? null;

  const model =
    requested === null || flags.provider === undefined
      ? requested
      : `${flags.provider}/${requested}`;

  return { model, effort: flags.effort ?? null };
}

function failureText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
