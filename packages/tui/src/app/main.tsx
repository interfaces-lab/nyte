/**
 * `runTui`: the interactive entry `index.ts` calls after `invocation.handoff()`.
 * Creates the renderer (parsers registered first, an app-owned
 * `NativeSession`, `exitOnCtrlC: false`, `openConsoleOnError: false`), the
 * crash log and process hooks, then mounts the app: store, runner, sinks,
 * kit, keymap and `<Root/>`. The host opens after the first paint, so the
 * loading line shows before any host work; local effects (the composer,
 * quitting) work meanwhile. Once the renderer has closed it prints the exit
 * output: failures, then "To resume previous session\nnyte --session=<id>\n".
 */
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import type { Host, SessionId } from "@nyte-ai/sdk";
import {
  CliRenderEvents,
  MouseButton,
  NativeSession,
  createCliRenderer,
  maybeMakeRenderable,
} from "@opentui/core";
import type { CliRenderer, Renderable } from "@opentui/core";
import { render } from "@opentui/solid";
import { createRoot, createSignal } from "solid-js";
import type { BootOptions } from "../effects/boot.ts";
import { createReporter, installProcessHooks, openCrashLog } from "../effects/crash.ts";
import { hostPort, pluginsPort } from "../effects/host-port.ts";
import {
  createHandle,
  filesPort,
  settingsPort,
  shellPort,
  systemClock,
} from "../effects/local-ports.ts";
import type { HostPort, Ports } from "../effects/ports.ts";
import { createRunner } from "../effects/runner.ts";
import { terminalPort } from "../effects/terminal-port.ts";
import { sessionRecovery } from "../flags.ts";
import type { RunFlags } from "../flags.ts";
import { openTerminalHost } from "../host.ts";
import type { ResolvedSettings } from "../lib/settings-schema.ts";
import { resolveThemeMode } from "../lib/theme.ts";
import type { PartMessage } from "../lib/view-helpers.ts";
import { initialState } from "../model/state.ts";
import type { FailureReport, TerminalFacts } from "../model/state.ts";
import { TUI_RENDERER_CONFIG } from "../services/rendering.ts";
import { registerSyntaxParsers } from "../services/syntax-parsers.ts";
import type { Kit } from "./context.tsx";
import { createKit } from "./kit.ts";
import { installKeymap } from "./keymap.ts";
import { Root } from "./root.tsx";
import { installSinks } from "./sinks.ts";
import { createStore } from "./store.ts";
import type { Store } from "./store.ts";
import { createTickers } from "./ticker.ts";

export type TuiExit =
  | { readonly kind: "quit" }
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" };

/** What `settings.read` replaces once boot has read the files. */
const STARTUP_SETTINGS: ResolvedSettings = {
  autoUpdate: false,
  theme: "auto",
  copyOnSelect: false,
  scrollAcceleration: false,
  followUp: "steer",
};

export interface AppOptions {
  readonly renderer: CliRenderer;
  readonly ports: Ports;
  readonly cwd: string;
  readonly drawPart: (message: PartMessage) => Renderable | null;
  /** Wraps the kit components draw with (tests make drawing throw through it). */
  readonly kit?: (kit: Kit) => Kit;
}

export interface MountedApp {
  readonly store: Store;
  /** Resolves with the exit code once something asked to close: `/quit`, Ctrl+C, the error screen's Q, a failed boot. */
  readonly closing: Promise<number>;
  /** The one error sink: crash log entry plus a `failure` fact. */
  readonly report: ReturnType<typeof createReporter>;
  /** Starts boot; call once `ports.host` is reachable. */
  boot(options: BootOptions): void;
  /** The failure that ended boot, once it failed. */
  startupError(): string | null;
  /** Stops every effect, resets the terminal outputs and unbinds keys. The renderer stays the caller's. */
  close(): Promise<void>;
}

/** Mounts the app on `renderer`; the binary and the app tests share it. */
export async function mountApp(options: AppOptions): Promise<MountedApp> {
  const { renderer, ports } = options;
  const controller = new AbortController();
  const closing = Promise.withResolvers<number>();
  const [fallen, setFallen] = createSignal<(() => void) | null>(null);
  let startupError: string | null = null;

  const report = createReporter(ports.log, (failure) =>
    root.store.dispatch({ kind: "failure", failure }),
  );

  const quit = (): void => closing.resolve(0);

  const root = createRoot((dispose) => {
    const store = createStore({
      initial: initialState({
        cwd: options.cwd,
        settings: STARTUP_SETTINGS,
        terminal: terminalFacts(renderer),
      }),
      now: () => ports.clock.now(),
      report,
      runner: (context) =>
        createRunner({
          ports,
          read: context.read,
          signal: controller.signal,
          dispatch(msg) {
            if (msg.kind === "effect-failed" && msg.effect === "boot") {
              startupError = msg.message;
              closing.resolve(1);
            }

            context.dispatch(msg);
          },
        }),
    });

    const sinks = installSinks(store, ports.terminal);

    const tickers = createTickers(ports.clock, (callback, intervalMs) => {
      const timer = setInterval(callback, intervalMs);

      return () => clearInterval(timer);
    });

    const kit = createKit({
      renderer,
      theme: sinks.theme,
      tickers,
      blob: (id) => ports.host.blob(id),
      drawPart: options.drawPart,
      attach: {
        composer: (port) => ports.composer.attach(port),
        scroll: (port) => ports.scroll.attach(port),
      },
      report,
    });

    return { store, sinks, kit, tickers, dispose };
  });

  const { store } = root;
  void store.runner.exited.then(({ code }) => closing.resolve(code));
  const uninstallKeymap = installKeymap({ renderer, store, fallen, quit });

  const syncTerminal = (): void => {
    const next = terminalFacts(renderer);
    const current = store.state().facts.terminal;

    if (
      next.width !== current.width ||
      next.height !== current.height ||
      next.theme !== current.theme ||
      next.selection !== current.selection ||
      next.dragging !== current.dragging
    )
      store.dispatch({ kind: "terminal", terminal: next });
  };

  const onSelection = (): void => {
    syncTerminal();
    const text = renderer.getSelection()?.getSelectedText() ?? "";

    if (store.state().facts.settings.copyOnSelect && text !== "")
      store.dispatch({ kind: "copy-text", text });
  };

  renderer.on(CliRenderEvents.RESIZE, syncTerminal);
  renderer.on(CliRenderEvents.THEME_MODE, syncTerminal);
  renderer.on(CliRenderEvents.SELECTION, onSelection);

  // Without copy-on-select, a right-click copies the highlight and keeps it.
  renderer.root.onMouseDown = (event) => {
    if (store.state().facts.settings.copyOnSelect || event.button !== Number(MouseButton.RIGHT))
      return;
    const selection = renderer.getSelection();
    const text =
      selection === null || (selection.isStart && selection.behavior === "cell")
        ? ""
        : selection.getSelectedText();

    if (text === "") return;
    event.preventDefault();
    event.stopPropagation();
    store.dispatch({ kind: "copy-text", text });
  };

  renderer.once(CliRenderEvents.DESTROY, () => {
    // A signal can destroy the renderer before `close`; the native session takes writes until this returns.
    root.sinks.dispose();
    renderer.off(CliRenderEvents.RESIZE, syncTerminal);
    renderer.off(CliRenderEvents.THEME_MODE, syncTerminal);
    renderer.off(CliRenderEvents.SELECTION, onSelection);
    renderer.root.onMouseDown = undefined;
    root.tickers.dispose();
    root.kit.dispose();
    store.dispose();
    root.dispose();
  });

  const drawn = options.kit?.(root.kit) ?? root.kit;

  await render(
    () => (
      <Root
        store={store}
        kit={drawn}
        report={report}
        logPath={ports.log.path}
        quit={quit}
        onFallen={(reset) => setFallen(() => reset)}
      />
    ),
    renderer,
  );

  return {
    store,
    closing: closing.promise,
    report,
    boot: (boot) => store.runner.boot(boot),
    startupError: () => startupError,
    async close() {
      controller.abort();
      await store.runner.dispose();
      root.sinks.dispose();
      uninstallKeymap();
    },
  };
}

export async function runTui(flags: RunFlags): Promise<TuiExit> {
  const cwd = process.cwd();
  const home = process.env["NYTE_HOME"] ?? join(homedir(), ".nyte");
  const log = openCrashLog(home);
  const failures: string[] = [];
  let exit: TuiExit = { kind: "quit" };
  const signalled = Promise.withResolvers<void>();

  const onSignal = (signal: "SIGINT" | "SIGTERM"): void => {
    exit = { kind: "signal", signal };
    signalled.resolve();
  };

  const onSigint = (): void => onSignal("SIGINT");
  const onSigterm = (): void => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  const cleanup = async (resource: string, dispose: () => unknown): Promise<void> => {
    try {
      await dispose();
    } catch (cause) {
      failures.push(`${resource} cleanup failed: ${messageOf(cause)}`);
    }
  };

  // Grammars are registered before the first renderer so the tree-sitter
  // worker knows them the moment it starts.
  registerSyntaxParsers();
  const native = new NativeSession(process.stdout);

  const renderer = await createCliRenderer({
    ...TUI_RENDERER_CONFIG,
    nativeSession: native,
    exitOnCtrlC: false,
    autoFocus: false,
    enableMouseMovement: true,
    clearOnShutdown: true,
    openConsoleOnError: false,
  });

  const encoder = new TextEncoder();
  const terminal = terminalPort(renderer, { write: (text) => native.write(encoder.encode(text)) });

  let opened: {
    readonly host: Host;
    readonly port: HostPort;
    readonly plugins: Awaited<ReturnType<typeof pluginsPort>>;
  } | null = null;

  const reachable = (): NonNullable<typeof opened> => {
    if (opened === null) throw new Error("The host is still opening.");

    return opened;
  };

  const ports: Ports = {
    get host() {
      return reachable().port;
    },
    get plugins() {
      return reachable().plugins;
    },
    terminal,
    composer: createHandle(),
    scroll: createHandle(),
    settings: settingsPort(),
    shell: shellPort(),
    files: filesPort(),
    clock: systemClock,
    log,
  };

  const app = await mountApp({
    renderer,
    ports,
    cwd,
    drawPart: (message) => maybeMakeRenderable(renderer, opened?.plugins.draw(message)),
  });

  const unhook = installProcessHooks(app.report);
  // Owned from the moment it opens, so a startup cancelled meanwhile still closes it.
  let host: Host | null = null;
  let closed = false;

  const opening = (async (): Promise<void> => {
    await terminal.painted();
    host = await openTerminalHost();

    const plugins = await pluginsPort(host, {
      notify: (title, body, sound) => terminal.notify(title, body, sound),
      report: (plugin, message) =>
        app.store.dispatch({ kind: "inform", tone: "error", text: `${plugin}: ${message}` }),
    });

    opened = { host, port: hostPort(host), plugins };

    if (!closed) app.boot({ home, cwd, target: bootTarget(flags), ...flagSelection(flags) });
  })().catch((cause: unknown) => {
    failures.unshift(`error: ${messageOf(cause)}`);
  });

  const code = await Promise.race([
    app.closing,
    signalled.promise.then(() => 0),
    opening.then(() => (failures.length > 0 ? 1 : new Promise<number>(() => undefined))),
  ]);

  closed = true;
  // Startup can still be opening the host; settle it so nothing reports after the recovery command.
  await opening;
  const session = app.store.state().facts.session?.id ?? null;
  await cleanup("TUI", () => app.close());
  const startupError = app.startupError();

  if (startupError !== null) failures.unshift(`error: ${startupError}`);
  await cleanup("Plugins", () => opened?.plugins.dispose());
  await cleanup("Clipboard", () => terminal.dispose());
  // OpenTUI 0.6 restores (and clears) the terminal after destroy returns; output written
  // before `closed` settles would be wiped by that restore.
  await cleanup("Terminal", async () => {
    renderer.destroy();
    await renderer.closed;
  });
  await cleanup("Host", () => host?.close());
  unhook();
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);

  // Restoration ends in escape bytes, not a newline; the text starts on a line of its own.
  process.stdout.write(exitText({ session, failures, crashes: app.store.state().local.failures }));

  if ((code !== 0 || failures.length > 0) && exit.kind === "quit") process.exit(1);

  return exit;
}

/**
 * What the terminal shows after the app closed: every crash report and
 * failure on its own line, then the command that resumes the session. The
 * two resume lines stay plain and last, even in raw PTY captures.
 */
export function exitText(input: {
  readonly session: SessionId | null;
  readonly failures: readonly string[];
  readonly crashes: readonly FailureReport[];
}): string {
  const lines = [
    ...input.crashes.map((crash) => `error: ${crash.message} (details in ${crash.logPath})`),
    ...input.failures,
    ...(input.session === null
      ? []
      : ["To resume previous session", sessionRecovery(input.session).command]),
  ];

  return lines.length === 0 ? "" : `\n${lines.map((line) => `${line}\n`).join("")}`;
}

/** What the renderer reports about the terminal, as the `terminal` fact carries it. */
function terminalFacts(renderer: CliRenderer): TerminalFacts {
  const selection = renderer.getSelection();

  return {
    width: renderer.width,
    height: renderer.height,
    theme: resolveThemeMode("auto", renderer.themeMode),
    selection: renderer.hasSelection,
    dragging: selection?.isDragging ?? false,
  };
}

function bootTarget(flags: RunFlags): BootOptions["target"] {
  return flags.resume.kind === "session"
    ? { kind: "session", id: asId(flags.resume.id) }
    : flags.resume;
}

/** `--provider`/`--model` (or `NYTE_MODEL`) as one `provider/id` or bare id, and `--effort`. */
function flagSelection(flags: RunFlags): Pick<BootOptions, "model" | "effort"> {
  const requested = flags.model ?? process.env["NYTE_MODEL"] ?? null;

  const model =
    requested === null || flags.provider === undefined
      ? requested
      : `${flags.provider}/${requested}`;

  return { model, effort: flags.effort ?? null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
