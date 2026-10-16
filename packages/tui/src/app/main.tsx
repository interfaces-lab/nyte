import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import {
  CliRenderEvents,
  CliRenderer,
  MouseButton,
  NativeSession,
  maybeMakeRenderable,
} from "@opentui/core";
import type { Renderable } from "@opentui/core";
import { render } from "@opentui/solid";
import { createRoot, createSignal } from "solid-js";
import type { BootOptions } from "../effects/boot.ts";
import { createReporter, installProcessHooks, openCrashLog } from "../effects/crash.ts";
import { hostPort, pluginsPort } from "../effects/host-port.ts";
import { createHandle, filesPort, settingsPort, shellPort } from "../effects/local-ports.ts";
import type { CrashLog, HostPort, PluginsPort, Ports, TerminalPort } from "../effects/ports.ts";
import { createRunner } from "../effects/runner.ts";
import { terminalPort } from "../effects/terminal-port.ts";
import { sessionRecovery } from "../flags.ts";
import type { RunFlags } from "../flags.ts";
import { connectLocalService, watchRemote } from "../service.ts";
import type { ServiceSession } from "../service.ts";
import type { ResolvedSettings } from "../lib/settings-schema.ts";
import { resolveThemeMode } from "../lib/theme.ts";
import type { PartMessage } from "../lib/view-helpers.ts";
import type { Msg } from "../model/msg.ts";
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
import { holdTypeahead } from "./typeahead.ts";
import type { Typeahead } from "./typeahead.ts";

export type TuiExit =
  | { readonly kind: "quit" }
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" };

const STARTUP_SETTINGS: ResolvedSettings = {
  autoUpdate: false,
  theme: "auto",
  copyOnSelect: false,
  scrollAcceleration: false,
  followUp: "steer",
};

/** Ports that work before the host opens. The app adds the host, its plugins and the renderer's clock. */
export type LocalPorts = Omit<Ports, "host" | "plugins" | "clock">;

/** The host once it is reachable, and what the app closes with it. */
export interface OpenedHost {
  readonly host: HostPort;
  readonly plugins: PluginsPort;
  readonly drawPart: (message: PartMessage) => Renderable | null;
  close(): Promise<void>;
}

export interface AppOptions {
  readonly renderer: CliRenderer;
  readonly ports: LocalPorts;
  readonly cwd: string;
  readonly boot: BootOptions;
  /** Opens the host. The app paints and takes typing at once, and boots when this resolves. */
  readonly open: (dispatch: (msg: Msg) => void) => Promise<OpenedHost>;
  /** Keys held since the renderer began reading stdin, replayed once the composer has focus. */
  readonly typeahead?: Typeahead;
  readonly kit?: (kit: Kit) => Kit;
}

export interface MountedApp {
  readonly store: Store;
  readonly closing: Promise<number>;
  readonly report: ReturnType<typeof createReporter>;
  startupError(): string | null;
  close(): Promise<void>;
}

/**
 * Mounts the app on `renderer` and focuses the composer before the host exists, so input
 * paints at once; opens the host alongside and boots once it is reachable. Every timer
 * runs on `renderer.clock`.
 */
export async function mountApp(options: AppOptions): Promise<MountedApp> {
  const { renderer } = options;
  const controller = new AbortController();
  const closing = Promise.withResolvers<number>();
  const [fallen, setFallen] = createSignal<(() => void) | null>(null);
  let startupError: string | null = null;
  let opened: OpenedHost | null = null;

  const reachable = (): OpenedHost => {
    if (opened === null) throw new Error("The host is still opening.");

    return opened;
  };

  const ports: Ports = {
    ...options.ports,
    clock: renderer.clock,
    get host() {
      return reachable().host;
    },
    get plugins() {
      return reachable().plugins;
    },
  };

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
      now: () => renderer.clock.now(),
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
    const tickers = createTickers(renderer.clock);

    const kit = createKit({
      renderer,
      theme: sinks.theme,
      tickers,
      blob: (id) => ports.host.blob(id),
      drawPart: (message) => opened?.drawPart(message) ?? null,
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

  const opening = options.open(store.dispatch).then((host) => {
    opened = host;

    return host;
  });

  opening.catch(() => undefined);
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

  options.typeahead?.release();
  store.runner.boot(
    options.boot,
    opening.then(() => undefined),
  );

  return {
    store,
    closing: closing.promise,
    report,
    startupError: () => startupError,
    async close() {
      controller.abort();
      await store.runner.dispose();
      root.sinks.dispose();
      uninstallKeymap();
      const host = await opening.catch(() => null);
      await host?.close();
    },
  };
}

/**
 * Runs the interactive TUI: connects to the service from the first instruction, holds keys
 * typed before the app mounts, and prints the resume command on exit. The exit text waits
 * for `renderer.closed`, because OpenTUI restores and clears the terminal after `destroy`
 * returns and would wipe anything written before.
 */
export async function runTui(flags: RunFlags): Promise<TuiExit> {
  const connecting = connectLocalService();
  connecting.catch(() => undefined);
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

  const app = await mountApp({
    renderer,
    cwd,
    typeahead,
    ports: {
      terminal,
      composer: createHandle(),
      scroll: createHandle(),
      settings: settingsPort(),
      shell: shellPort(),
      files: filesPort(),
      log,
    },
    boot: { home, cwd, target: bootTarget(flags), ...flagSelection(flags) },
    open: (dispatch) => openService({ connecting, renderer, terminal, log, cwd, dispatch }),
  });

  const unhook = installProcessHooks(app.report);
  const code = await Promise.race([app.closing, signalled.promise.then(() => 0)]);
  const session = app.store.state().facts.session?.id ?? null;
  await cleanup("TUI", () => app.close());
  const startupError = app.startupError();

  if (startupError !== null) failures.unshift(`error: ${startupError}`);
  await cleanup("Clipboard", () => terminal.dispose());
  await cleanup("Terminal", async () => {
    renderer.destroy();
    await renderer.closed;
  });
  unhook();
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);

  process.stdout.write(exitText({ session, failures, crashes: app.store.state().local.failures }));

  if ((code !== 0 || failures.length > 0) && exit.kind === "quit") process.exit(1);

  return exit;
}

/** Opens the background service's host for the TUI: its plugins, and the Nyte Connect status. */
async function openService(input: {
  readonly connecting: Promise<ServiceSession>;
  readonly renderer: CliRenderer;
  readonly terminal: TerminalPort;
  readonly log: CrashLog;
  readonly cwd: string;
  readonly dispatch: (msg: Msg) => void;
}): Promise<OpenedHost> {
  const { connection, registration } = await input.connecting;
  const remote = new AbortController();

  const close = async (): Promise<void> => {
    remote.abort();
    await connection.close();
  };

  void watchRemote(registration, remote.signal, (facts) =>
    input.dispatch({ kind: "remote", remote: facts }),
  ).catch((cause: unknown) => {
    if (!remote.signal.aborted) input.log.write("watch", cause);
  });

  const plugins = await pluginsPort(connection, {
    notify: (title, body, sound) => input.terminal.notify(title, body, sound),
    report: (plugin, message) =>
      input.dispatch({ kind: "inform", tone: "error", text: `plugin ${plugin}: ${message}` }),
  }).catch(async (cause: unknown) => {
    await close();

    throw cause;
  });

  return {
    host: hostPort(connection, input.cwd),
    plugins,
    drawPart: (message) => maybeMakeRenderable(input.renderer, plugins.draw(message)),
    async close() {
      try {
        await plugins.dispose();
      } finally {
        await close();
      }
    },
  };
}

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
