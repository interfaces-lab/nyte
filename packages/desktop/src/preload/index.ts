/**
 * `window.nyte`: the SDK interfaces verbatim (design record, "What each client
 * deletes" — desktop). Every verb is one `invoke` carrying its path and input
 * object; `watch` is the one transport adaptation, an AsyncIterable become a
 * push subscription with the same cursor semantics.
 *
 * Main owns request decoding and reply construction. Preload preserves each
 * path's input/output relationship instead of widening transport payloads.
 */
import { DEFAULT_LANDING } from "@nyte-ai/core";
import type { SessionEvent } from "@nyte-ai/core";
import { contextBridge, ipcRenderer } from "electron";
import {
  BROWSER_BOUNDS_CHANNEL,
  CALL_CHANNEL,
  HOST_EVENT_CHANNEL,
  THEME_PREFERENCE_CHANNEL,
  WATCH_EVENT_CHANNEL,
  WATCH_START_CHANNEL,
  WATCH_STOP_CHANNEL,
} from "../shared/ipc.ts";
import type {
  BrowserBoundsMessage,
  CallInput,
  CallOutput,
  CallPath,
  CallReplyFor,
  HostEvent,
  NyteBridge,
  WatchEnvelope,
  WatchInput,
  WatchStartInput,
} from "../shared/ipc.ts";
import { errorMessage } from "../shared/errors.ts";

async function call<P extends CallPath>(path: P, input: CallInput<P>): Promise<CallOutput<P>> {
  // SAFETY: only Nyte's main process handles CALL_CHANNEL; it decodes the path-specific
  // request and echoes that path in the matching CallReplyFor<P> envelope.
  const result = (await ipcRenderer.invoke(CALL_CHANNEL, { path, input })) as CallReplyFor<P>;
  if (result.path !== path) throw new Error("Malformed reply from the host: path mismatch");
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function verb<P extends CallPath>(path: P): (input: CallInput<P>) => Promise<CallOutput<P>> {
  return (input) => call(path, input);
}

const bridge = {
  // The host composes `createNyte` without a landing, so the policy in force is the default.
  landing: DEFAULT_LANDING,
  sessions: {
    create: (input) => call("sessions.create", input),
    get: verb("sessions.get"),
    snapshot: verb("sessions.snapshot"),
    list: (input) => call("sessions.list", input),
    rename: verb("sessions.rename"),
    setPinned: verb("sessions.setPinned"),
    setArchived: verb("sessions.setArchived"),
    delete: verb("sessions.delete"),
    configure: verb("sessions.configure"),
  },
  messages: {
    send: verb("messages.send"),
    cancel: verb("messages.cancel"),
    redeliver: verb("messages.redeliver"),
  },
  runs: {
    abort: verb("runs.abort"),
    changes: verb("runs.changes"),
  },
  heads: {
    move: verb("heads.move"),
  },
  workspace: {
    list: () => call("workspace.list", undefined),
    forget: verb("workspace.forget"),
    vcs: {
      diff: (input) => call("workspace.vcs.diff", input),
    },
  },
  provider: {
    models: {
      default: () => call("provider.models.default", undefined),
    },
  },
  plugins: {
    catalog: () => call("plugins.catalog", undefined),
    list: verb("plugins.list"),
    commands: {
      list: verb("plugins.commands.list"),
      run: verb("plugins.commands.run"),
    },
    settings: {
      list: verb("plugins.settings.list"),
      apply: verb("plugins.settings.apply"),
    },
    resources: { list: verb("plugins.resources.list") },
  },
  watch(
    input: WatchInput,
    onEvent: (event: SessionEvent) => void,
    onError?: (error: Error) => void,
  ) {
    const watchId = crypto.randomUUID();
    let ended = false;
    const fail = (message: string): void => {
      if (ended) return;
      ended = true;
      onError?.(new Error(message));
    };
    // WATCH_EVENT_CHANNEL is private to Nyte main and emits only WatchEnvelope.
    const listener = (_event: Electron.IpcRendererEvent, frame: WatchEnvelope): void => {
      if (frame.watchId !== watchId || ended) return;
      if (frame.kind === "event") {
        onEvent(frame.event);
        return;
      }
      if (frame.error !== undefined) fail(frame.error);
      else fail("Watch ended unexpectedly");
    };
    ipcRenderer.on(WATCH_EVENT_CHANNEL, listener);
    const start: WatchStartInput =
      "live" in input
        ? { watchId, sessionId: input.sessionId, live: true }
        : input.afterSeq === undefined
          ? { watchId, sessionId: input.sessionId }
          : { watchId, sessionId: input.sessionId, afterSeq: input.afterSeq };
    // A refused start (bad cursor, no workspace) is a watch that ended before it began.
    const started = ipcRenderer.invoke(WATCH_START_CHANNEL, start).catch((error) => {
      fail(errorMessage(error));
    });
    return () => {
      ended = true;
      ipcRenderer.removeListener(WATCH_EVENT_CHANNEL, listener);
      // START and STOP use separate invoke channels. Preserve their order so a
      // fast unmount cannot stop first and leave the later start orphaned.
      void started
        .then(() => ipcRenderer.invoke(WATCH_STOP_CHANNEL, { watchId }))
        .catch(() => undefined);
    };
  },
  host: {
    setThemePreference: (preference) => ipcRenderer.send(THEME_PREFERENCE_CHANNEL, preference),
    state: () => call("host.state", undefined),
    fonts: () => call("host.fonts", undefined),
    openWorkspace: verb("host.openWorkspace"),
    pickWorkspace: () => call("host.pickWorkspace", undefined),
    trustWorkspace: verb("host.trustWorkspace"),
    closeWorkspace: () => call("host.closeWorkspace", undefined),
    catalog: () => call("host.catalog", undefined),
    login: verb("host.login"),
    logout: verb("host.logout"),
    setPreference: verb("host.setPreference"),
    vcs: { snapshot: () => call("host.vcs.snapshot", undefined) },
    files: { list: () => call("host.files.list", undefined) },
    github: {
      state: () => call("host.github.state", undefined),
      refresh: () => call("host.github.refresh", undefined),
      signIn: () => call("host.github.signIn", undefined),
      signOut: () => call("host.github.signOut", undefined),
    },
    openExternal: verb("host.openExternal"),
    terminal: {
      create: verb("host.terminal.create"),
      write: verb("host.terminal.write"),
      resize: verb("host.terminal.resize"),
      acknowledge: verb("host.terminal.acknowledge"),
      close: verb("host.terminal.close"),
    },
    browser: {
      open: verb("host.browser.open"),
      navigate: verb("host.browser.navigate"),
      menu: verb("host.browser.menu"),
      perform: verb("host.browser.perform"),
      close: verb("host.browser.close"),
      setBounds: (message: BrowserBoundsMessage) =>
        ipcRenderer.send(BROWSER_BOUNDS_CHANNEL, message),
    },
    onEvent(listener: (event: HostEvent) => void) {
      // HOST_EVENT_CHANNEL is private to Nyte main and emits only HostEvent.
      const wrapped = (_event: Electron.IpcRendererEvent, event: HostEvent): void => {
        listener(event);
      };
      ipcRenderer.on(HOST_EVENT_CHANNEL, wrapped);
      return () => {
        ipcRenderer.removeListener(HOST_EVENT_CHANNEL, wrapped);
      };
    },
  },
} satisfies NyteBridge;

contextBridge.exposeInMainWorld("nyte", bridge);
window.addEventListener(
  "DOMContentLoaded",
  () => {
    document.documentElement.dataset["platform"] = process.platform;
  },
  { once: true },
);
