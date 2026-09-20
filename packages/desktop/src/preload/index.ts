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
import { contextBridge, ipcRenderer, webUtils } from "electron";
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

type NoneCallPath = {
  [P in CallPath]: [CallInput<P>] extends [undefined] ? P : never;
}[CallPath];

function none<P extends NoneCallPath>(path: P): () => Promise<CallOutput<P>> {
  return () => call(path, undefined);
}

function object<P extends Exclude<CallPath, NoneCallPath>>(
  path: P,
): (input: CallInput<P>) => Promise<CallOutput<P>> {
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
    create: object("sessions.create"),
    get: object("sessions.get"),
    snapshot: object("sessions.snapshot"),
    metadata: object("sessions.metadata"),
    list: object("sessions.list"),
    rename: object("sessions.rename"),
    setPinned: object("sessions.setPinned"),
    setArchived: object("sessions.setArchived"),
    delete: object("sessions.delete"),
    configure: object("sessions.configure"),
  },
  messages: {
    send: object("messages.send"),
    cancel: object("messages.cancel"),
    redeliver: object("messages.redeliver"),
  },
  jobs: {
    list: object("jobs.list"),
    start: object("jobs.start"),
    background: object("jobs.background"),
    cancel: object("jobs.cancel"),
  },
  runs: {
    abort: object("runs.abort"),
    reply: object("runs.reply"),
    diff: object("runs.diff"),
  },
  heads: {
    move: object("heads.move"),
  },
  workspace: {
    list: none("workspace.list"),
    forget: object("workspace.forget"),
    vcs: {
      snapshot: object("workspace.vcs.snapshot"),
      diff: object("workspace.vcs.diff"),
      contents: object("workspace.vcs.contents"),
      log: object("workspace.vcs.log"),
      refs: object("workspace.vcs.refs"),
      stage: object("workspace.vcs.stage"),
      discard: object("workspace.vcs.discard"),
      commit: object("workspace.vcs.commit"),
      createBranch: object("workspace.vcs.createBranch"),
      push: object("workspace.vcs.push"),
    },
  },
  provider: {
    models: {
      default: none("provider.models.default"),
    },
  },
  plugins: {
    catalog: none("plugins.catalog"),
    list: object("plugins.list"),
    commands: {
      list: object("plugins.commands.list"),
      run: object("plugins.commands.run"),
    },
    settings: {
      list: object("plugins.settings.list"),
      apply: object("plugins.settings.apply"),
    },
    resources: { list: object("plugins.resources.list") },
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
    state: none("host.state"),
    sessionDirectory: none("host.sessionDirectory"),
    fonts: none("host.fonts"),
    openWorkspace: object("host.openWorkspace"),
    pickWorkspace: none("host.pickWorkspace"),
    trustWorkspace: object("host.trustWorkspace"),
    closeWorkspace: none("host.closeWorkspace"),
    catalog: object("host.catalog"),
    usage: object("host.usage"),
    accountLimits: none("host.accountLimits"),
    login: object("host.login"),
    cancelLogin: object("host.cancelLogin"),
    logout: object("host.logout"),
    setPreference: object("host.setPreference"),
    files: {
      list: object("host.files.list"),
      cancelList: object("host.files.cancelList"),
      read: object("host.files.read"),
      save: object("host.files.save"),
      search: editorOperation("search"),
      cancelSearch: editorOperation("cancelSearch"),
      blame: editorOperation("blame"),
      format: editorOperation("format"),
    },
    github: {
      state: none("host.github.state"),
      signIn: none("host.github.signIn"),
      signOut: none("host.github.signOut"),
      createPullRequest: object("host.github.createPullRequest"),
    },
    server: {
      state: none("host.server.state"),
      connect: object("host.server.connect"),
      disconnect: none("host.server.disconnect"),
      createSession: none("host.server.createSession"),
    },
    mobile: {
      state: none("host.mobile.state"),
      start: object("host.mobile.start"),
      stop: none("host.mobile.stop"),
    },
    openExternal: object("host.openExternal"),
    revealPath: object("host.revealPath"),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    contextMenu: object("host.contextMenu"),
    terminal: {
      create: object("host.terminal.create"),
      write: object("host.terminal.write"),
      resize: object("host.terminal.resize"),
      acknowledge: object("host.terminal.acknowledge"),
      idle: object("host.terminal.idle"),
      close: object("host.terminal.close"),
    },
    browser: {
      open: object("host.browser.open"),
      navigate: object("host.browser.navigate"),
      menu: object("host.browser.menu"),
      perform: object("host.browser.perform"),
      close: object("host.browser.close"),
      captureFrame: object("host.browser.captureFrame"),
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
