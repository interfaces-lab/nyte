import { idSchema } from "@nyte-ai/schema";
import type {
  Connection,
  HostView,
  Job,
  JobKey,
  JobView,
  SessionId,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { Type } from "typebox";
import { useSyncExternalStore } from "react";
import { TERMINAL_NOTICE_LIMITS } from "../../contract/bridge.ts";
import { errorMessage } from "../../contract/errors.ts";
import { nyte } from "../../contract/nyte.ts";
import { connected } from "../../data/connection.ts";
import { hostWatch } from "../../data/watches.ts";
import { workspacePath as pathOfWorkspace } from "../../data/workspaces.ts";
import type { WorkbenchTabId } from "../model.ts";
import { persisted } from "../../lib/storage.ts";
import { createTerminalReader } from "./terminal-output.ts";
import type { OscNotice } from "./terminal-notifications.ts";
import type { ProgramRecord } from "./terminal-program-status.ts";

type ShellTerminalState =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly exitCode: number | null }
  | { readonly kind: "failed"; readonly message: string };

type JobTerminalState = JobView["state"];

type TerminalRenderingState =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly message: string };

type TerminalStreamState =
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  | { readonly kind: "failed"; readonly message: string };

interface TerminalTabFields {
  readonly id: WorkbenchTabId;
  readonly title: string;
  readonly cwd: string;
  readonly program: readonly ProgramRecord[];
}

interface ShellTerminalTab extends TerminalTabFields {
  readonly kind: "shell";
  readonly state: ShellTerminalState;
}

interface JobTerminalTab extends TerminalTabFields {
  readonly kind: "job";
  readonly workspace: WorkspaceId;
  readonly jobId: JobView["id"];
  readonly session: SessionId | null;
  readonly state: JobTerminalState;
  readonly rendering: TerminalRenderingState;
  readonly stream: TerminalStreamState;
}

export type TerminalTab = ShellTerminalTab | JobTerminalTab;

export interface TerminalOutput {
  reset(): void;
  write(data: Uint8Array): void;
  update(tab: TerminalTab): void;
  visible(): boolean;
  dispose(): void;
}

interface Feed {
  readonly job: Job;
  readonly workspace: WorkspaceId;
  readonly printed: string[];
  readonly reader: ReturnType<typeof createTerminalReader>;
  length: number;
}

interface TerminalSnapshot {
  readonly tabs: ReadonlyMap<WorkbenchTabId, TerminalTab>;
}

const KEPT_OUTPUT = 64 * 1024;

const SAVE_DELAY_MS = 2_000;

const SAVED_PREFIX = "nyte.terminal.";

const savedShell = Type.Object({
  workspace: idSchema<"workspace">(),
  key: Type.Union([idSchema<"job-key">(), Type.Null()]),
  printed: Type.String(),
});

const encoder = new TextEncoder();

const GAP_TEXT = "\r\n\u001b[2m[output skipped]\u001b[0m\r\n";

const GAP = encoder.encode("\u0018" + GAP_TEXT);

let snapshot: TerminalSnapshot = { tabs: new Map() };

const listeners = new Set<() => void>();

const output = new Map<WorkbenchTabId, TerminalOutput>();

const queued = new Map<WorkbenchTabId, Uint8Array[]>();

const feeds = new Map<WorkbenchTabId, Feed>();

const typedAhead = new Map<WorkbenchTabId, Uint8Array[]>();

const flushing = new Map<WorkbenchTabId, Promise<void>>();

const creating = new Map<WorkbenchTabId, Promise<void>>();

const saving = new Map<WorkbenchTabId, ReturnType<typeof setTimeout>>();

function publish(tabs: ReadonlyMap<WorkbenchTabId, TerminalTab>): void {
  snapshot = { tabs };

  for (const listener of listeners) listener();
}

function update(id: WorkbenchTabId, change: (tab: TerminalTab) => TerminalTab): void {
  const tab = snapshot.tabs.get(id);

  if (tab === undefined) return;
  const next = change(tab);

  if (next === tab) return;
  output.get(id)?.update(next);
  publish(new Map(snapshot.tabs).set(id, next));
}

function updateShell(id: WorkbenchTabId, state: ShellTerminalState): void {
  update(id, (tab) => (tab.kind === "job" ? tab : { ...tab, state }));
}

function updateStream(id: WorkbenchTabId, stream: TerminalStreamState): void {
  update(id, (tab) => (tab.kind === "job" ? { ...tab, stream } : tab));
}

function updateProgram(id: WorkbenchTabId, program: readonly ProgramRecord[]): void {
  update(id, (tab) => (tab.program === program ? tab : { ...tab, program }));
}

function getSnapshot(): TerminalSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useTerminal(id: WorkbenchTabId): TerminalTab | undefined {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return current.tabs.get(id);
}

export function useTerminalRuntime(): ReadonlyMap<WorkbenchTabId, TerminalTab> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).tabs;
}

export function getTerminal(id: WorkbenchTabId): TerminalTab | undefined {
  return snapshot.tabs.get(id);
}

export function terminalPrinted(id: WorkbenchTabId): string {
  return feeds.get(id)?.printed.join("") ?? "";
}

function keep(feed: Feed, data: string): void {
  feed.printed.push(data);
  feed.length += data.length;

  while (feed.printed.length > 1 && feed.length - (feed.printed[0]?.length ?? 0) >= KEPT_OUTPUT)
    feed.length -= feed.printed.shift()?.length ?? 0;
}

export function attachTerminalOutput(id: WorkbenchTabId, sink: TerminalOutput): void {
  output.set(id, sink);

  for (const data of queued.get(id) ?? []) sink.write(data);
  queued.delete(id);
}

function print(id: WorkbenchTabId, data: Uint8Array, text: string): void {
  const feed = feeds.get(id);

  if (feed !== undefined) keep(feed, text);
  const sink = output.get(id);

  if (sink !== undefined) sink.write(data);
  else {
    const waiting = queued.get(id) ?? [];
    waiting.push(data);
    queued.set(id, waiting);
  }

  if (feed !== undefined && shellTab(id) !== undefined) scheduleSave(id);
}

function shellTab(id: WorkbenchTabId): ShellTerminalTab | undefined {
  const tab = getTerminal(id);

  return tab !== undefined && tab.kind === "shell" ? tab : undefined;
}

async function follow(id: WorkbenchTabId, feed: Feed): Promise<void> {
  let decoder = new TextDecoder();
  let replay = getTerminal(id)?.kind === "job";

  try {
    for await (const frame of feed.job.output()) {
      if (feeds.get(id) !== feed) return;

      if (replay) {
        replay = false;
        feed.printed.length = 0;
        feed.length = 0;
        queued.delete(id);
        output.get(id)?.reset();
      }

      if (frame.kind === "bytes") {
        const text = decoder.decode(frame.data, { stream: true });
        print(id, frame.data, text);
        const status = feed.reader.read(text);
        updateProgram(id, status.records);
        postNotices(id, status.notices);

        if (status.reply !== "") void terminalActions.write(id, encoder.encode(status.reply));
      } else if (frame.kind === "gap") {
        decoder = new TextDecoder();
        updateProgram(id, feed.reader.gap());
        print(id, GAP, GAP_TEXT);
      } else {
        updateProgram(id, feed.reader.close());

        if (shellTab(id) !== undefined) updateShell(id, { kind: "exited", exitCode: frame.code });
      }
    }
  } catch (cause: unknown) {
    if (feeds.get(id) !== feed) return;
    const message = errorMessage(cause);

    if (shellTab(id) === undefined) updateStream(id, { kind: "failed", message });
    else updateShell(id, { kind: "failed", message });
  }
}

function postNotices(id: WorkbenchTabId, notices: readonly OscNotice[]): void {
  if (notices.length === 0) return;
  const attention = nyte.host.attention;

  if (attention === undefined) return;

  if (document.hasFocus() && output.get(id)?.visible() === true) return;
  const title = getTerminal(id)?.title ?? "Terminal";

  for (const notice of notices)
    attention.notify({
      title: (notice.title ?? title).slice(0, TERMINAL_NOTICE_LIMITS.title),
      body: notice.body.slice(0, TERMINAL_NOTICE_LIMITS.body),
    });
}

function savedOutput(id: WorkbenchTabId) {
  return persisted(SAVED_PREFIX + id, savedShell, null);
}

function save(id: WorkbenchTabId): void {
  clearTimeout(saving.get(id));
  saving.delete(id);
  const feed = feeds.get(id);

  if (feed === undefined) return;
  savedOutput(id).set({
    workspace: feed.workspace,
    key: feed.job.key,
    printed: feed.printed.join("").slice(-KEPT_OUTPUT),
  });
}

function scheduleSave(id: WorkbenchTabId): void {
  if (saving.has(id)) return;
  saving.set(
    id,
    setTimeout(() => save(id), SAVE_DELAY_MS),
  );
}

function forgetSaved(id: WorkbenchTabId): void {
  clearTimeout(saving.get(id));
  saving.delete(id);
  savedOutput(id).remove();
}

if (globalThis.window !== undefined)
  window.addEventListener("pagehide", () => {
    for (const id of feeds.keys()) if (shellTab(id) !== undefined) save(id);
  });

async function readHostView(connection: Connection): Promise<HostView> {
  for await (const view of connection.watch()) return view;

  throw new Error("The host closed before describing itself");
}

async function reattach(
  connection: Connection,
  saved: { readonly workspace: WorkspaceId; readonly key: JobKey },
  history: string,
): Promise<Feed | null> {
  const recovered = await connection
    .workspace(saved.workspace)
    .jobs.recover(saved.key)
    .catch(() => null);

  return recovered !== null && "id" in recovered
    ? {
        job: recovered,
        workspace: saved.workspace,
        printed: [],
        reader: createTerminalReader({ kind: "shell", history }),
        length: 0,
      }
    : null;
}

async function spawnShell(connection: Connection, workspacePath: string | null): Promise<Feed> {
  const workspace = await findShellWorkspace(connection, workspacePath);

  const job = await connection
    .workspace(workspace)
    .jobs.start({ pty: { columns: 80, rows: 24 }, title: "Terminal" });

  return {
    job,
    workspace,
    printed: [],
    reader: createTerminalReader({ kind: "shell", history: "" }),
    length: 0,
  };
}

async function findShellWorkspace(
  connection: Connection,
  path: string | null,
): Promise<WorkspaceId> {
  if (path === null) {
    const home = (hostWatch("host").value ?? (await readHostView(connection))).defaultWorkspace;

    if (home === null) throw new Error("This host has no Home folder to open a terminal in");

    return home;
  }

  const found = (await connection.workspaces.list()).find(
    (workspace) =>
      pathOfWorkspace(workspace) === path && workspace.availability.kind === "available",
  );

  if (found === undefined) throw new Error(`${path} is not open on this host`);

  return found.id;
}

function writeFailed(id: WorkbenchTabId, cause: unknown): void {
  const current = getTerminal(id);

  if (current === undefined || current.kind !== "shell" || current.state.kind !== "running") return;
  toast.add({
    type: "error",
    title: "Couldn't write to terminal",
    id: "terminal-write-" + id,
    description: errorMessage(cause),
  });
}

function startShell(
  id: WorkbenchTabId,
  workspacePath: string | null,
  restore: { readonly workspace: WorkspaceId; readonly key: JobKey } | null,
  printed: string,
): Promise<void> {
  publish(
    new Map(snapshot.tabs).set(id, {
      id,
      title: "Terminal",
      cwd: workspacePath ?? "",
      program: [],
      kind: "shell",
      state: { kind: "starting" },
    }),
  );

  const pending = (async () => {
    const connection = await connected();
    const reattached = restore === null ? null : await reattach(connection, restore, printed);
    const feed = reattached ?? (await spawnShell(connection, workspacePath));

    if (getTerminal(id) === undefined) {
      await feed.job.stop();
      await feed.job.close();

      return;
    }

    feeds.set(id, feed);

    if (reattached === null && printed !== "") {
      const restored = `${printed}\r\n\u001b[2m[restored, new shell]\u001b[0m\r\n`;
      print(id, encoder.encode(restored), restored);
    }

    updateShell(id, { kind: "running" });
    void follow(id, feed);
    const ahead = typedAhead.get(id) ?? [];
    typedAhead.delete(id);

    if (ahead.length > 0)
      flushing.set(
        id,
        feed.job
          .write(joinBytes(ahead))
          .catch((cause: unknown) => writeFailed(id, cause))
          .finally(() => flushing.delete(id)),
      );
    save(id);
  })()
    .catch((cause: unknown) => {
      typedAhead.delete(id);
      const message = errorMessage(cause);
      updateShell(id, { kind: "failed", message });
      toast.add({ type: "error", title: "Couldn't start terminal", description: message });
    })
    .finally(() => creating.delete(id));

  creating.set(id, pending);

  return pending;
}

export function reattachShells(
  shells: Iterable<{ readonly id: WorkbenchTabId; readonly workspacePath: string | null }>,
): void {
  for (const { id, workspacePath } of shells) {
    const saved = savedOutput(id).get();

    if (saved === null || saved.key === null || snapshot.tabs.has(id) || creating.has(id)) continue;
    const { key } = saved;

    const pending = (async () => {
      const feed = await reattach(
        await connected(),
        { workspace: saved.workspace, key },
        saved.printed,
      );

      if (feed === null) return;

      if (snapshot.tabs.has(id)) {
        await feed.job.close();

        return;
      }

      publish(
        new Map(snapshot.tabs).set(id, {
          id,
          title: "Terminal",
          cwd: workspacePath ?? "",
          program: [],
          kind: "shell",
          state: { kind: "running" },
        }),
      );
      feeds.set(id, feed);
      void follow(id, feed);
    })()
      .catch(() => undefined)
      .finally(() => creating.delete(id));

    creating.set(id, pending);
  }
}

function syncJobs(workspace: WorkspaceId, jobs: readonly JobView[]): void {
  const commands = new Map(jobs.map((job) => [job.id, job]));
  const tabs = new Map(snapshot.tabs);
  let changed = false;

  for (const tab of snapshot.tabs.values()) {
    if (tab.kind !== "job" || tab.workspace !== workspace) continue;
    const job = commands.get(tab.jobId);

    if (job === undefined) continue;

    if (
      tab.title === job.command &&
      tab.state.kind === job.state.kind &&
      tab.session === job.session
    )
      continue;

    changed = true;

    const next: JobTerminalTab = {
      ...tab,
      title: job.command,
      state: job.state,
      session: job.session,
    };

    tabs.set(tab.id, next);
    output.get(tab.id)?.update(next);
  }

  if (changed) publish(tabs);
}

function disposeOutput(id: WorkbenchTabId): void {
  output.get(id)?.dispose();
  output.delete(id);
  queued.delete(id);
}

function followJob(tab: JobTerminalTab): void {
  const id = tab.id;
  const previous = feeds.get(id);

  const pending = Promise.resolve()
    .then(async () => {
      await previous?.job.close();
      const connection = await connected();

      if (creating.get(id) !== pending) return;

      const feed: Feed = {
        job: connection.workspace(tab.workspace).job(tab.jobId),
        workspace: tab.workspace,
        printed: [...(previous?.printed ?? [])],
        reader: createTerminalReader({ kind: "job" }),
        length: previous?.length ?? 0,
      };

      feeds.set(id, feed);
      updateStream(id, { kind: "connected" });
      void follow(id, feed);
    })
    .catch((cause: unknown) => {
      if (creating.get(id) === pending)
        updateStream(id, { kind: "failed", message: errorMessage(cause) });
    })
    .finally(() => {
      if (creating.get(id) === pending) creating.delete(id);
    });

  creating.set(id, pending);
}

function remove(id: WorkbenchTabId): void {
  disposeOutput(id);
  creating.delete(id);
  typedAhead.delete(id);
  feeds.delete(id);
  forgetSaved(id);
  const tabs = new Map(snapshot.tabs);
  tabs.delete(id);
  publish(tabs);
}

export const terminalActions = {
  create({
    id,
    workspacePath,
  }: {
    readonly id: WorkbenchTabId;
    readonly workspacePath: string | null;
  }): Promise<void> {
    return startShell(id, workspacePath, null, "");
  },
  restore({
    id,
    workspacePath,
  }: {
    readonly id: WorkbenchTabId;
    readonly workspacePath: string | null;
  }): Promise<void> {
    const pending = creating.get(id);

    if (pending !== undefined)
      return pending.then(() =>
        snapshot.tabs.has(id) ? undefined : terminalActions.restore({ id, workspacePath }),
      );

    if (snapshot.tabs.has(id)) return Promise.resolve();
    const saved = savedOutput(id).get();

    return startShell(
      id,
      workspacePath,
      saved === null || saved.key === null ? null : { workspace: saved.workspace, key: saved.key },
      saved?.printed ?? "",
    );
  },
  openJob({
    id,
    workspace,
    job,
  }: {
    readonly id: WorkbenchTabId;
    readonly workspace: WorkspaceId;
    readonly job: JobView;
  }): void {
    const existing = snapshot.tabs.get(id);

    if (existing !== undefined && existing.kind === "job") {
      syncJobs(workspace, [job]);

      return;
    }

    const tab: JobTerminalTab = {
      id,
      title: job.command,
      cwd: "",
      program: [],
      kind: "job",
      workspace,
      jobId: job.id,
      session: job.session,
      state: job.state,
      rendering: { kind: "ready" },
      stream: { kind: "connecting" },
    };

    publish(new Map(snapshot.tabs).set(id, tab));
    followJob(tab);
  },
  syncJobs,
  acknowledge(id: WorkbenchTabId): void {
    const feed = feeds.get(id);

    if (feed !== undefined) updateProgram(id, feed.reader.acknowledge());
  },
  write(id: WorkbenchTabId, data: Uint8Array): Promise<void> {
    const tab = getTerminal(id);
    const feed = feeds.get(id);

    if (tab?.kind === "shell" && tab.state.kind === "starting") {
      typedAhead.set(id, [...(typedAhead.get(id) ?? []), data]);

      return Promise.resolve();
    }

    if (tab === undefined || tab.kind !== "shell" || tab.state.kind !== "running" || !feed)
      return Promise.resolve();

    const ahead = flushing.get(id);

    const sent =
      ahead === undefined ? feed.job.write(data) : ahead.then(() => feed.job.write(data));

    return sent.catch((cause: unknown) => writeFailed(id, cause));
  },
  async resize(id: WorkbenchTabId, columns: number, rows: number): Promise<void> {
    await feeds.get(id)?.job.resize({ columns, rows });
  },
  async idle(id: WorkbenchTabId): Promise<boolean> {
    const feed = feeds.get(id);

    return feed === undefined ? true : feed.job.idle();
  },
  title(id: WorkbenchTabId, title: string): void {
    const clean = Array.from(title)
      .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
      .join("")
      .trim()
      .slice(0, 160);

    const tab = getTerminal(id);

    if (tab === undefined || tab.kind === "job" || clean === "" || tab.title === clean) return;
    update(id, (current) => (current.kind === "job" ? current : { ...current, title: clean }));
  },
  fail(id: WorkbenchTabId, message: string): void {
    const tab = getTerminal(id);

    if (tab === undefined) return;

    if (tab.kind === "job") {
      update(id, (current) =>
        current.kind === "shell" ? current : { ...current, rendering: { kind: "failed", message } },
      );

      return;
    }

    updateShell(id, { kind: "failed", message });
    const feed = feeds.get(id);

    if (feed !== undefined) updateProgram(id, feed.reader.close());
    feeds.delete(id);
    void feed?.job.stop().catch(() => undefined);
  },
  retryRender(id: WorkbenchTabId): void {
    const tab = getTerminal(id);

    if (tab?.kind !== "job" || tab.rendering.kind !== "failed") return;
    disposeOutput(id);
    queued.set(id, [encoder.encode(terminalPrinted(id))]);
    update(id, (current) =>
      current.kind === "shell" ? current : { ...current, rendering: { kind: "ready" } },
    );
  },
  retryStream(id: WorkbenchTabId): void {
    const tab = getTerminal(id);

    if (tab?.kind !== "job" || tab.stream.kind !== "failed") return;
    updateStream(id, { kind: "connecting" });
    followJob(tab);
  },
  async close(id: WorkbenchTabId): Promise<void> {
    const tab = getTerminal(id);

    if (tab !== undefined && tab.kind === "shell") {
      await creating.get(id);
      const feed = feeds.get(id);
      await feed?.job.stop();
    }

    const feed = feeds.get(id);
    remove(id);
    await feed?.job.close();
  },
};

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  chunks.reduce((at, chunk) => {
    joined.set(chunk, at);

    return at + chunk.length;
  }, 0);

  return joined;
}
