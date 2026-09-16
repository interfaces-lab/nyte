/**
 * `window.nyte`: the SDK interfaces verbatim (design record, "What each client
 * deletes" — desktop). Every operation is one `invoke` carrying its path and input
 * object; `watch` is the one transport adaptation, an AsyncIterable become a
 * push subscription with the same cursor semantics.
 *
 * Main owns request decoding and reply construction. Preload preserves each
 * path's input/output relationship instead of widening transport payloads.
 */
import { DEFAULT_LANDING } from "@nyte-ai/core";
import type { SessionEvent } from "@nyte-ai/core";
import { contextBridge, ipcRenderer } from "electron";
import { APP_MENU_COMMAND_CHANNEL, APP_MENU_READY_CHANNEL } from "../shared/app-menu.ts";
import type { AppMenuCommand } from "../shared/app-menu.ts";
import {
  BROWSER_BOUNDS_CHANNEL,
  CALL_CHANNEL,
  HOST_EVENT_CHANNEL,
  THEME_PREFERENCE_CHANNEL,
  WATCH_EVENT_CHANNEL,
  WATCH_START_CHANNEL,
  WATCH_STOP_CHANNEL,
  WORKSPACE_EDITOR_CHANNEL,
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
  WorkspaceEditorInput,
  WorkspaceEditorOperation,
  WorkspaceEditorOutput,
  WorkspaceEditorReply,
} from "../shared/ipc.ts";
import { bridgeError } from "../shared/errors.ts";
import type { IpcResult } from "../shared/errors.ts";

async function call<P extends CallPath>(path: P, input: CallInput<P>): Promise<CallOutput<P>> {
  // SAFETY: only Nyte's main process handles CALL_CHANNEL; it decodes the path-specific
  // request and echoes that path in the matching CallReplyFor<P> envelope.
  const result = (await ipcRenderer.invoke(CALL_CHANNEL, { path, input })) as CallReplyFor<P>;
  if (!result.ok) return Promise.reject(bridgeError(result.error));
  if (result.path !== path) throw new Error("Malformed reply from the host: path mismatch");
  return result.value;
}

function operation<P extends CallPath>(path: P): (input: CallInput<P>) => Promise<CallOutput<P>> {
  return (input) => call(path, input);
}

function editorOperation<P extends WorkspaceEditorOperation>(operation: P) {
  return async (input: WorkspaceEditorInput<P>): Promise<WorkspaceEditorOutput<P>> => {
    // SAFETY: the private main handler validates the operation's input and owns its reply.
    const result = (await ipcRenderer.invoke(WORKSPACE_EDITOR_CHANNEL, {
      operation,
      input,
    })) as WorkspaceEditorReply<P>;
    if (!result.ok) return Promise.reject(bridgeError(result.error));
    return result.value;
  };
}

const bridge = {
  // The host composes `createNyte` without a landing, so the policy in force is the default.
  landing: DEFAULT_LANDING,
  sessions: {
    create: (input) => call("sessions.create", input),
    get: operation("sessions.get"),
    snapshot: operation("sessions.snapshot"),
    metadata: operation("sessions.metadata"),
    list: (input) => call("sessions.list", input),
    rename: operation("sessions.rename"),
    setPinned: operation("sessions.setPinned"),
    setArchived: operation("sessions.setArchived"),
    delete: operation("sessions.delete"),
    configure: operation("sessions.configure"),
  },
  messages: {
    send: operation("messages.send"),
    cancel: operation("messages.cancel"),
    redeliver: operation("messages.redeliver"),
  },
  jobs: {
    list: operation("jobs.list"),
    start: operation("jobs.start"),
    background: operation("jobs.background"),
    cancel: operation("jobs.cancel"),
  },
  runs: {
    abort: operation("runs.abort"),
    reply: operation("runs.reply"),
  },
  heads: {
    move: operation("heads.move"),
  },
  workspace: {
    list: () => call("workspace.list", undefined),
    forget: operation("workspace.forget"),
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
    list: operation("plugins.list"),
    commands: {
      list: operation("plugins.commands.list"),
      run: operation("plugins.commands.run"),
    },
    settings: {
      list: operation("plugins.settings.list"),
      apply: operation("plugins.settings.apply"),
    },
    resources: { list: operation("plugins.resources.list") },
  },
  watch(
    input: WatchInput,
    onEvent: (event: SessionEvent) => void,
    onError?: (error: Error) => void,
  ) {
    const watchId = crypto.randomUUID();
    let ended = false;
    const fail = (error: Error): void => {
      if (ended) return;
      ended = true;
      // An ended watch receives nothing more; only the host-side stop still owes a call.
      ipcRenderer.removeListener(WATCH_EVENT_CHANNEL, listener);
      onError?.(error);
    };
    // WATCH_EVENT_CHANNEL is private to Nyte main and emits only WatchEnvelope.
    const listener = (_event: Electron.IpcRendererEvent, frame: WatchEnvelope): void => {
      if (frame.watchId !== watchId || ended) return;
      if (frame.kind === "event") {
        onEvent(frame.event);
        return;
      }
      if (frame.error !== undefined) fail(bridgeError(frame.error));
      else fail(new Error("Watch ended unexpectedly"));
    };
    ipcRenderer.on(WATCH_EVENT_CHANNEL, listener);
    const start: WatchStartInput =
      "live" in input
        ? { watchId, sessionId: input.sessionId, live: true }
        : input.afterSeq === undefined
          ? { watchId, sessionId: input.sessionId }
          : { watchId, sessionId: input.sessionId, afterSeq: input.afterSeq };
    // A refused start (bad cursor, no workspace) is a watch that ended before it began.
    const started = ipcRenderer
      .invoke(WATCH_START_CHANNEL, start)
      .then((result: IpcResult<void>) => {
        if (!result.ok) fail(bridgeError(result.error));
      })
      .catch(() => fail(new Error("The host watch could not start.")));
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
    onMenuCommand(listener: (command: AppMenuCommand) => void) {
      // Only the main process sends this private channel; never expose the IPC event.
      const wrapped = (_event: Electron.IpcRendererEvent, command: AppMenuCommand): void => {
        listener(command);
      };
      ipcRenderer.on(APP_MENU_COMMAND_CHANNEL, wrapped);
      ipcRenderer.send(APP_MENU_READY_CHANNEL);
      return () => ipcRenderer.removeListener(APP_MENU_COMMAND_CHANNEL, wrapped);
    },
    setThemePreference: (preference) => ipcRenderer.send(THEME_PREFERENCE_CHANNEL, preference),
    state: () => call("host.state", undefined),
    sessionDirectory: () => call("host.sessionDirectory", undefined),
    fonts: () => call("host.fonts", undefined),
    openWorkspace: operation("host.openWorkspace"),
    pickWorkspace: () => call("host.pickWorkspace", undefined),
    trustWorkspace: operation("host.trustWorkspace"),
    closeWorkspace: () => call("host.closeWorkspace", undefined),
    catalog: (input) => call("host.catalog", input),
    usage: operation("host.usage"),
    accountLimits: () => call("host.accountLimits", undefined),
    login: operation("host.login"),
    cancelLogin: operation("host.cancelLogin"),
    logout: operation("host.logout"),
    setPreference: operation("host.setPreference"),
    vcs: {
      snapshot: () => call("host.vcs.snapshot", undefined),
      contents: operation("host.vcs.contents"),
      diff: operation("host.vcs.diff"),
      log: operation("host.vcs.log"),
      refs: () => call("host.vcs.refs", undefined),
      revert: operation("host.vcs.revert"),
      stage: operation("host.vcs.stage"),
      commit: operation("host.vcs.commit"),
      createBranch: operation("host.vcs.createBranch"),
      push: operation("host.vcs.push"),
      createPullRequest: operation("host.vcs.createPullRequest"),
    },
    files: {
      list: (input) => call("host.files.list", input),
      cancelList: (input) => call("host.files.cancelList", input),
      read: operation("host.files.read"),
      save: operation("host.files.save"),
      search: editorOperation("search"),
      cancelSearch: editorOperation("cancelSearch"),
      blame: editorOperation("blame"),
      format: editorOperation("format"),
    },
    github: {
      state: () => call("host.github.state", undefined),
      signIn: () => call("host.github.signIn", undefined),
      signOut: () => call("host.github.signOut", undefined),
    },
    server: {
      state: () => call("host.server.state", undefined),
      connect: (input) => call("host.server.connect", input),
      disconnect: () => call("host.server.disconnect", undefined),
      createSession: () => call("host.server.createSession", undefined),
    },
    mobile: {
      state: () => call("host.mobile.state", undefined),
      start: (input) => call("host.mobile.start", input),
      stop: () => call("host.mobile.stop", undefined),
    },
    openExternal: operation("host.openExternal"),
    revealPath: operation("host.revealPath"),
    contextMenu: operation("host.contextMenu"),
    terminal: {
      create: operation("host.terminal.create"),
      write: operation("host.terminal.write"),
      resize: operation("host.terminal.resize"),
      acknowledge: operation("host.terminal.acknowledge"),
      idle: operation("host.terminal.idle"),
      close: operation("host.terminal.close"),
    },
    browser: {
      open: operation("host.browser.open"),
      navigate: operation("host.browser.navigate"),
      menu: operation("host.browser.menu"),
      perform: operation("host.browser.perform"),
      close: operation("host.browser.close"),
      captureFrame: operation("host.browser.captureFrame"),
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
