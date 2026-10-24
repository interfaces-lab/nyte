import type { Connection, SessionId } from "@nyte-ai/sdk";
import type { LocalEndpoint } from "@nyte-ai/service";
import { CliRenderEvents, MouseButton, engine, maybeMakeRenderable } from "@opentui/core";
import type { CliRenderer, Renderable } from "@opentui/core";
import { RendererContext, _render, createComponent } from "@opentui/solid";
import { createRoot, createSignal } from "solid-js";
import type { PartMessage } from "@nyte-ai/plugin/client/presentation";
import { launchChat } from "../effects/boot.ts";
import type { BootOptions } from "../effects/boot.ts";
import { createReporter } from "../effects/crash.ts";
import { hostPort, pluginsPort } from "../effects/host-port.ts";
import { ignoredSettingsText } from "../services/settings.ts";
import type { HostPort, PluginsPort, Ports } from "../effects/ports.ts";
import { createRunner } from "../effects/runner.ts";
import { exitStatus } from "../lifecycle.ts";
import { installMiniScrollback } from "../mini/scrollback.ts";
import { followRemote } from "../local-host.ts";
import type { Msg } from "../model/msg.ts";
import { followedSession, initialState } from "../model/state.ts";
import { waitingMessages } from "../model/table-input.ts";
import type { FailureReport, TerminalFacts } from "../model/state.ts";
import { readDraft } from "../ui/composer/composer.tsx";
import type { Kit } from "./context.tsx";
import type { AppKeymap } from "./keyboard.ts";
import { createKit } from "./kit.ts";
import { composerEditor, installKeymap } from "./keymap.ts";
import { Root } from "./root.tsx";
import { installSinks } from "./sinks.ts";
import { createStore } from "./store.ts";
import type { Store } from "./store.ts";
import { createTickers } from "./ticker.ts";
import type { Typeahead } from "./typeahead.ts";

export type LocalPorts = Omit<Ports, "host" | "plugins" | "clock">;

export interface HostLink {
  readonly connection: Connection;
  readonly endpoint: LocalEndpoint | null;
  readonly folder: string | null;
}

export type ClientPlugins = PluginsPort & {
  draw(message: PartMessage): unknown;
  dispose(): Promise<void>;
};

export interface Carry {
  readonly session: SessionId | null;
  readonly draft: string;
}

export interface ExitFacts {
  readonly session: SessionId | null;
  readonly unsent: string | null;
  readonly crashes: readonly FailureReport[];
}

export interface AppOptions {
  readonly renderer: CliRenderer;
  readonly keymap: AppKeymap;
  readonly ports: LocalPorts;
  readonly cwd: string;
  readonly boot: BootOptions;
  readonly host: Promise<HostLink>;
  readonly hungUp: AbortSignal;
  readonly plugins?: (link: HostLink, dispatch: (msg: Msg) => void) => Promise<ClientPlugins>;
  readonly typeahead?: Typeahead;
  readonly kit?: (kit: Kit) => Kit;
  readonly draft?: string;
}

export interface MountedApp {
  readonly store: Store;
  readonly closing: Promise<number>;
  report(origin: FailureReport["origin"], error: unknown): void;
  startupError(): string | null;
  carry(): Carry;
  busy(): string | null;
  exit(): ExitFacts;
  close(): Promise<void>;
}

interface OpenedHost {
  readonly host: HostPort;
  readonly plugins: ClientPlugins;
  close(): Promise<void>;
}

export async function mountApp(options: AppOptions): Promise<MountedApp> {
  const { renderer } = options;
  const controller = new AbortController();
  const closing = Promise.withResolvers<number>();
  const [fallen, setFallen] = createSignal<(() => void) | null>(null);
  let startupError: string | null = null;
  let opened: OpenedHost | null = null;
  const hostOpened = Promise.withResolvers<void>();
  hostOpened.promise.catch(() => undefined);

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
  const hangUp = (): void => closing.resolve(exitStatus("SIGHUP"));
  const { settings, invalid } = options.ports.settings.read(options.cwd);
  const chat = launchChat(options.boot, options.ports.firstFrame.read());

  const root = createRoot((dispose) => {
    const store = createStore({
      initial: initialState({
        cwd: options.cwd,
        settings,
        terminal: terminalFacts(renderer),
        chat,
      }),
      now: () => renderer.clock.now(),
      report,
      runner: (context) =>
        createRunner({
          ports,
          read: context.read,
          signal: controller.signal,
          opened: hostOpened.promise,
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
      drawPart: (message) => drawnPart(renderer, opened?.plugins.draw(message)),
      attach: {
        composer: (port) => ports.composer.attach(port),
        scroll: (port) => ports.scroll.attach(port),
      },
      report,
    });

    return { store, sinks, kit, tickers, dispose };
  });

  const { store } = root;

  if (invalid.length > 0)
    store.dispatch({
      kind: "inform",
      tone: "warning",
      text: ignoredSettingsText(invalid),
    });
  void store.runner.exited.then(({ code }) => closing.resolve(code));

  const opening = options.host.then(async (link) => {
    const host = await openHost(link, options, store.dispatch, controller.signal);
    opened = host;
    hostOpened.resolve();
    store.dispatch({ kind: "host-opened" });

    return host;
  });

  opening.catch((cause: unknown) => hostOpened.reject(cause));
  const uninstallKeymap = installKeymap({ renderer, keymap: options.keymap, store, fallen, quit });

  const syncTerminal = (): void => {
    const next = terminalFacts(renderer);
    const current = store.state().facts.terminal;

    if (
      next.width !== current.width ||
      next.height !== current.height ||
      next.theme !== current.theme ||
      next.selection !== current.selection ||
      next.dragging !== current.dragging ||
      next.hyperlinks !== current.hyperlinks
    )
      store.dispatch({ kind: "terminal", terminal: next });
  };

  const onSelection = (): void => {
    syncTerminal();
    const text = renderer.getSelection()?.getSelectedText() ?? "";

    if (store.state().facts.settings.copyOnSelect && text !== "")
      store.dispatch({ kind: "copy-text", text });
  };

  const onFocus = (): void => store.dispatch({ kind: "terminal-focus", focused: true });
  const onBlur = (): void => store.dispatch({ kind: "terminal-focus", focused: false });

  renderer.on(CliRenderEvents.RESIZE, syncTerminal);
  renderer.on(CliRenderEvents.THEME_MODE, syncTerminal);
  renderer.on(CliRenderEvents.CAPABILITIES, syncTerminal);
  renderer.on(CliRenderEvents.SELECTION, onSelection);
  renderer.on(CliRenderEvents.FOCUS, onFocus);
  renderer.on(CliRenderEvents.BLUR, onBlur);
  options.hungUp.addEventListener("abort", hangUp);

  if (options.hungUp.aborted) hangUp();

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

  let unmount: (() => void) | null = null;
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    renderer.off(CliRenderEvents.DESTROY, destroyed);
    options.hungUp.removeEventListener("abort", hangUp);
    renderer.off(CliRenderEvents.RESIZE, syncTerminal);
    renderer.off(CliRenderEvents.THEME_MODE, syncTerminal);
    renderer.off(CliRenderEvents.CAPABILITIES, syncTerminal);
    renderer.off(CliRenderEvents.SELECTION, onSelection);
    renderer.off(CliRenderEvents.FOCUS, onFocus);
    renderer.off(CliRenderEvents.BLUR, onBlur);
    renderer.root.onMouseDown = undefined;
    uninstallKeymap();
    mini?.dispose();
    unmount?.();

    for (const child of renderer.root.getChildren()) {
      if (present.has(child)) continue;
      renderer.root.remove(child);
      child.destroyRecursively();
    }

    root.sinks.dispose();
    root.tickers.dispose();
    root.kit.dispose();
    store.dispose();
    root.dispose();
  };

  const destroyed = (): void => {
    hangUp();
    release();
  };

  renderer.once(CliRenderEvents.DESTROY, destroyed);

  const drawn = options.kit?.(root.kit) ?? root.kit;

  const mini =
    renderer.screenMode === "split-footer"
      ? installMiniScrollback({ renderer, store, kit: drawn })
      : null;

  const present = new Set(renderer.root.getChildren());
  engine.attach(renderer);

  unmount = _render(
    () =>
      createComponent(RendererContext.Provider, {
        value: renderer,
        get children() {
          return (
            <Root
              store={store}
              kit={drawn}
              report={report}
              logPath={ports.log.path}
              quit={quit}
              onFallen={(reset) => setFallen(() => reset)}
            />
          );
        },
      }),
    renderer.root,
  );

  store.runner.boot(options.boot);

  if (options.draft !== undefined && options.draft !== "")
    store.dispatch({ kind: "draft-restored", text: options.draft });
  options.typeahead?.release();
  store.runner.run({ kind: "refresh-workspace", cwd: options.cwd });

  let closed: Promise<void> | null = null;

  return {
    store,
    closing: closing.promise,
    report,
    startupError: () => startupError,
    carry() {
      const editor = composerEditor(renderer);

      return {
        session: followedSession(store.state())?.id ?? null,
        draft: editor === null ? store.state().local.draft.text : readDraft(editor).text,
      };
    },
    busy() {
      const { facts, local } = store.state();
      const running = facts.shells.find((job) => job.state.kind === "running");

      if (running !== undefined) return `!${running.command}`;

      return local.pending[0]?.kind ?? null;
    },
    exit() {
      const state = store.state();
      const waiting = waitingMessages(state).map((sent) => sent.snapshot.text);

      return {
        session: followedSession(state)?.id ?? null,
        unsent: waiting.length === 0 ? null : waiting.join("\n\n"),
        crashes: state.local.failures,
      };
    },
    close: () =>
      (closed ??= (async () => {
        controller.abort();
        await store.runner.dispose();
        await mini?.close();
        release();
        const host = await opening.catch(() => null);
        await host?.close();
      })()),
  };
}

export function resumeOptions(options: AppOptions, carry: Carry, typeahead: Typeahead): AppOptions {
  return {
    ...options,
    typeahead,
    draft: carry.draft,
    boot: {
      ...options.boot,
      start: "reload",
      target: carry.session === null ? { kind: "new" } : { kind: "session", id: carry.session },
      model: null,
      effort: null,
    },
  };
}

async function openHost(
  link: HostLink,
  options: AppOptions,
  dispatch: (msg: Msg) => void,
  signal: AbortSignal,
): Promise<OpenedHost> {
  const remote = new AbortController();
  signal.addEventListener("abort", () => remote.abort(), { once: true });

  if (link.endpoint !== null)
    followRemote(
      link.endpoint,
      remote.signal,
      (facts) => dispatch({ kind: "remote", remote: facts }),
      (cause) => options.ports.log.write("watch", cause),
    );

  const plugins = await (
    options.plugins === undefined
      ? terminalPlugins(link, options.ports, dispatch)
      : options.plugins(link, dispatch)
  ).catch((cause: unknown) => {
    remote.abort();

    throw cause;
  });

  return {
    host: hostPort(link.connection, link.folder, () => nextFrame(options.renderer)),
    plugins,
    async close() {
      remote.abort();
      await plugins.dispose();
    },
  };
}

function terminalPlugins(
  link: HostLink,
  ports: LocalPorts,
  dispatch: (msg: Msg) => void,
): Promise<ClientPlugins> {
  return pluginsPort(link.connection, {
    notify: (title, body, sound) => ports.terminal.notify(title, body, sound),
    report: (plugin, message) =>
      dispatch({ kind: "inform", tone: "error", text: `plugin ${plugin}: ${message}` }),
  });
}

export function drawnPart(renderer: CliRenderer, drawn: unknown): Renderable | null {
  return drawn === undefined || drawn === null ? null : maybeMakeRenderable(renderer, drawn);
}

export function nextFrame(renderer: CliRenderer): Promise<void> {
  return new Promise((resolve) => renderer.once(CliRenderEvents.FRAME, () => resolve()));
}

function terminalFacts(renderer: CliRenderer): TerminalFacts {
  const selection = renderer.getSelection();

  return {
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
    theme: renderer.themeMode,
    selection: renderer.hasSelection,
    dragging: selection?.isDragging ?? false,
    hyperlinks: renderer.capabilities?.hyperlinks === true,
  };
}
