import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
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
} from "../effects/local-ports.ts";
import type { HostPort, Ports } from "../effects/ports.ts";
import { createRunner } from "../effects/runner.ts";
import { terminalPort } from "../effects/terminal-port.ts";
import { sessionRecovery } from "../flags.ts";
import type { RunFlags } from "../flags.ts";
import { connectLocalService, watchRemote } from "../service.ts";
import type { ServiceSession } from "../service.ts";
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
  readonly kit?: (kit: Kit) => Kit;
}

export interface MountedApp {
  readonly store: Store;
  readonly closing: Promise<number>;
  readonly report: ReturnType<typeof createReporter>;
  boot(options: BootOptions): void;
  startupError(): string | null;
  close(): Promise<void>;
}

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

    const tickers = createTickers(ports.clock);

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
    clock: renderer.clock,
    log,
  };

  const app = await mountApp({
    renderer,
    ports,
    cwd,
    drawPart: (message) => maybeMakeRenderable(renderer, opened?.plugins.draw(message)),
  });

  const unhook = installProcessHooks(app.report);
  let host: ServiceSession | null = null;
  let closed = false;
  const remote = new AbortController();

  const opening = (async (): Promise<void> => {
    await terminal.painted();
    host = await connectLocalService();
    const { connection, registration } = host;

    void watchRemote(registration, remote.signal, (facts) =>
      app.store.dispatch({ kind: "remote", remote: facts }),
    ).catch((error: unknown) => {
      if (!remote.signal.aborted) log.write("watch", error);
    });

    const plugins = await pluginsPort(connection, {
      notify: (title, body, sound) => terminal.notify(title, body, sound),
      report: (plugin, message) =>
        app.store.dispatch({ kind: "inform", tone: "error", text: `plugin ${plugin}: ${message}` }),
    });

    opened = { port: hostPort(connection, cwd), plugins };

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
  remote.abort();
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
  await cleanup("Host", () => host?.connection.close());
  unhook();
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);

  process.stdout.write(exitText({ session, failures, crashes: app.store.state().local.failures }));

  if ((code !== 0 || failures.length > 0) && exit.kind === "quit") process.exit(1);

  return exit;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
