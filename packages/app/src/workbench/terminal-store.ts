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
import { Value } from "typebox/value";
import { useSyncExternalStore } from "react";
import { errorMessage } from "../errors.ts";
import { connected, hostWatch } from "../sdk.tsx";
import { workspacePath as pathOfWorkspace } from "../view-helpers.ts";
import type { WorkbenchController, WorkbenchTabId, WorkbenchViewKey } from "./controller.ts";

type ShellTerminalState =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly exitCode: number | null }
  | { readonly kind: "failed"; readonly message: string };

type JobTerminalState = JobView["state"];

type TerminalRenderingState =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly message: string };

interface TerminalTabFields {
  readonly id: WorkbenchTabId;
  readonly title: string;
  readonly cwd: string;
}

/** A user's login shell, which takes input. */
interface ShellTerminalTab extends TerminalTabFields {
  readonly kind: "shell";
  readonly state: ShellTerminalState;
}

/** An agent's job, shown read-only. */
interface JobTerminalTab extends TerminalTabFields {
  readonly kind: "job";
  readonly sessionId: SessionId;
  readonly jobId: JobView["id"];
  readonly state: JobTerminalState;
  readonly rendering: TerminalRenderingState;
}

export type TerminalTab = ShellTerminalTab | JobTerminalTab;

export interface TerminalOutput {
  write(data: string): void;
  update(tab: TerminalTab): void;
  dispose(): void;
}

/** The job behind an open tab, and the chunks it printed while the tab showed it, the oldest dropped past 64 Ki characters. */
interface Feed {
  readonly job: Job;
  readonly workspace: WorkspaceId;
  readonly printed: string[];
  length: number;
}

interface TerminalSnapshot {
  readonly tabs: ReadonlyMap<WorkbenchTabId, TerminalTab>;
}

/** The output a tab keeps to restore after a restart, in characters of terminal stream. */
const KEPT_OUTPUT = 64 * 1024;

const SAVE_DELAY_MS = 2_000;

const SAVED_PREFIX = "nyte.terminal.";

const savedShell = Type.Object({
  workspace: idSchema<"workspace">(),
  key: Type.Union([idSchema<"job-key">(), Type.Null()]),
  printed: Type.String(),
});

const encoder = new TextEncoder();

let snapshot: TerminalSnapshot = { tabs: new Map() };

const listeners = new Set<() => void>();

const output = new Map<WorkbenchTabId, TerminalOutput>();

const queued = new Map<WorkbenchTabId, string[]>();

const feeds = new Map<WorkbenchTabId, Feed>();

/** What the user typed into a shell tab while its shell was starting, sent in order once it runs, as a terminal emulator keeps typeahead. */
const typedAhead = new Map<WorkbenchTabId, string[]>();

/** A shell tab's typeahead on its way to the shell, which input typed after it waits for. */
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

/** What the tab's job printed while the tab showed it, at most the last 64 Ki characters. */
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

function print(id: WorkbenchTabId, data: string): void {
  const feed = feeds.get(id);

  if (feed !== undefined) keep(feed, data);
  const sink = output.get(id);

  if (sink !== undefined) sink.write(data);
  else {
    const waiting = queued.get(id) ?? [];
    waiting.push(data);
    queued.set(id, waiting);
  }

  if (feed !== undefined && shellTab(id) !== undefined) scheduleSave(id);
}

/** The tab at `id` when it is a user's shell. */
function shellTab(id: WorkbenchTabId): ShellTerminalTab | undefined {
  const tab = getTerminal(id);

  return tab !== undefined && tab.kind === "shell" ? tab : undefined;
}

/** Streams a job's output into its tab until the job ends or the tab lets it go: the host replays the scrollback it kept first. */
async function follow(id: WorkbenchTabId, feed: Feed): Promise<void> {
  const decoder = new TextDecoder();

  try {
    for await (const frame of feed.job.output()) {
      if (feeds.get(id) !== feed) return;

      if (frame.kind === "bytes") print(id, decoder.decode(frame.data, { stream: true }));
      else if (frame.kind === "gap") print(id, "\r\n\u001b[2m[output skipped]\u001b[0m\r\n");
      else if (shellTab(id) !== undefined)
        updateShell(id, { kind: "exited", exitCode: frame.code });
    }
  } catch (cause: unknown) {
    if (feeds.get(id) === feed && shellTab(id) !== undefined)
      updateShell(id, { kind: "failed", message: errorMessage(cause) });
  }
}

function savedKey(id: WorkbenchTabId): string {
  return SAVED_PREFIX + id;
}

function save(id: WorkbenchTabId): void {
  clearTimeout(saving.get(id));
  saving.delete(id);
  const feed = feeds.get(id);

  if (feed === undefined) return;

  try {
    window.localStorage.setItem(
      savedKey(id),
      JSON.stringify({
        workspace: feed.workspace,
        key: feed.job.key,
        printed: feed.printed.join("").slice(-KEPT_OUTPUT),
      }),
    );
  } catch {
    return;
  }
}

function scheduleSave(id: WorkbenchTabId): void {
  if (saving.has(id)) return;
  saving.set(
    id,
    setTimeout(() => save(id), SAVE_DELAY_MS),
  );
}

function readSaved(id: WorkbenchTabId) {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(savedKey(id)) ?? "null");

    return Value.Check(savedShell, parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function forgetSaved(id: WorkbenchTabId): void {
  clearTimeout(saving.get(id));
  saving.delete(id);

  try {
    window.localStorage.removeItem(savedKey(id));
  } catch {
    return;
  }
}

if (globalThis.window !== undefined)
  window.addEventListener("pagehide", () => {
    for (const id of feeds.keys()) if (shellTab(id) !== undefined) save(id);
  });

async function readHostView(connection: Connection): Promise<HostView> {
  for await (const view of connection.watch()) return view;

  throw new Error("The host closed before describing itself");
}

/** The job a saved shell tab ran, when the host still runs it. */
async function reattach(
  connection: Connection,
  saved: { readonly workspace: WorkspaceId; readonly key: JobKey },
): Promise<Feed | null> {
  const recovered = await connection
    .workspace(saved.workspace)
    .jobs.recover(saved.key)
    .catch(() => null);

  return recovered !== null && "id" in recovered
    ? { job: recovered, workspace: saved.workspace, printed: [], length: 0 }
    : null;
}

async function spawnShell(connection: Connection, workspacePath: string | null): Promise<Feed> {
  const workspace = await findShellWorkspace(connection, workspacePath);

  const job = await connection
    .workspace(workspace)
    .jobs.start({ pty: { columns: 80, rows: 24 }, title: "Terminal" });

  return { job, workspace, printed: [], length: 0 };
}

/** The workspace a terminal opened at `path` runs in: the open folder there, or the host's Home for none. */
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
    (workspace) => pathOfWorkspace(workspace) === path,
  );

  if (found === undefined) throw new Error(`${path} is not open on this host`);

  return found.id;
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
      kind: "shell",
      state: { kind: "starting" },
    }),
  );

  const pending = (async () => {
    const connection = await connected();
    const reattached = restore === null ? null : await reattach(connection, restore);
    const feed = reattached ?? (await spawnShell(connection, workspacePath));

    if (getTerminal(id) === undefined) {
      await feed.job.stop();
      await feed.job.close();

      return;
    }

    feeds.set(id, feed);

    if (reattached === null && printed !== "")
      print(id, `${printed}\r\n\u001b[2m[restored, new shell]\u001b[0m\r\n`);
    save(id);
    updateShell(id, { kind: "running" });
    void follow(id, feed);
    const ahead = typedAhead.get(id) ?? [];
    typedAhead.delete(id);

    if (ahead.length === 0) return;
    const flushed = feed.job.write(encoder.encode(ahead.join("")));
    flushing.set(
      id,
      flushed.catch(() => undefined),
    );
    await flushed.finally(() => flushing.delete(id));
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

/**
 * Re-attaches the saved shell tabs among `shells` whose job the host still
 * runs, shown or not. Every open shell tab holds a reader this way, as one
 * shown since the window loaded does, and the host stops a user's shell left
 * without a reader for a minute. A tab whose shell is gone waits for its
 * panel, which starts a new one.
 */
export function reattachShells(
  shells: Iterable<{ readonly id: WorkbenchTabId; readonly workspacePath: string | null }>,
): void {
  for (const { id, workspacePath } of shells) {
    const saved = readSaved(id);

    if (saved === null || saved.key === null || snapshot.tabs.has(id) || creating.has(id)) continue;
    const { key } = saved;

    const pending = (async () => {
      const feed = await reattach(await connected(), { workspace: saved.workspace, key });

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

function syncJobs(sessionId: SessionId, jobs: readonly JobView[]): void {
  const commands = new Map(jobs.map((job) => [job.id, job]));
  const tabs = new Map(snapshot.tabs);
  let changed = false;

  for (const tab of snapshot.tabs.values()) {
    if (tab.kind !== "job" || tab.sessionId !== sessionId) continue;
    const job = commands.get(tab.jobId);

    if (job === undefined) continue;

    if (tab.title === job.command && tab.state.kind === job.state.kind) continue;

    changed = true;
    const next: JobTerminalTab = { ...tab, title: job.command, state: job.state };
    tabs.set(tab.id, next);
    output.get(tab.id)?.update(next);
  }

  if (changed) publish(tabs);
}

function remove(id: WorkbenchTabId): void {
  output.get(id)?.dispose();
  output.delete(id);
  queued.delete(id);
  typedAhead.delete(id);
  feeds.delete(id);
  forgetSaved(id);
  const tabs = new Map(snapshot.tabs);
  tabs.delete(id);
  publish(tabs);
}

export const terminalActions = {
  /** Starts a login shell as a pty job in the folder at `workspacePath`, or the host's Home for null. */
  create({
    id,
    workspacePath,
  }: {
    readonly id: WorkbenchTabId;
    readonly workspacePath: string | null;
  }): Promise<void> {
    return startShell(id, workspacePath, null, "");
  },
  /** Brings back a shell tab the workbench kept across a reload or restart: its job when the host still runs it (the host replays its scrollback), else a new shell under the output the tab saved. */
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
    const saved = readSaved(id);

    return startShell(
      id,
      workspacePath,
      saved === null || saved.key === null ? null : { workspace: saved.workspace, key: saved.key },
      saved?.printed ?? "",
    );
  },
  openJob({
    id,
    sessionId,
    job,
  }: {
    readonly id: WorkbenchTabId;
    readonly sessionId: SessionId;
    readonly job: JobView;
  }): void {
    const existing = snapshot.tabs.get(id);

    if (existing !== undefined && existing.kind === "job") {
      syncJobs(sessionId, [job]);

      return;
    }

    publish(
      new Map(snapshot.tabs).set(id, {
        id,
        title: job.command,
        cwd: "",
        kind: "job",
        sessionId,
        jobId: job.id,
        state: job.state,
        rendering: { kind: "ready" },
      }),
    );

    void (async () => {
      const connection = await connected();
      const { workspace } = await connection.session(sessionId).info();

      const feed: Feed = {
        job: connection.workspace(workspace).job(job.id),
        workspace,
        printed: [],
        length: 0,
      };

      if (getTerminal(id) === undefined) return;
      feeds.set(id, feed);
      await follow(id, feed);
    })().catch((cause: unknown) => terminalActions.fail(id, errorMessage(cause)));
  },
  syncJobs,
  write(id: WorkbenchTabId, data: string): Promise<void> {
    const tab = getTerminal(id);
    const feed = feeds.get(id);

    if (tab?.kind === "shell" && tab.state.kind === "starting") {
      typedAhead.set(id, [...(typedAhead.get(id) ?? []), data]);

      return Promise.resolve();
    }

    if (tab === undefined || tab.kind !== "shell" || tab.state.kind !== "running" || !feed)
      return Promise.resolve();

    const ahead = flushing.get(id);

    return ahead === undefined
      ? feed.job.write(encoder.encode(data))
      : ahead.then(() => feed.job.write(encoder.encode(data)));
  },
  async resize(id: WorkbenchTabId, columns: number, rows: number): Promise<void> {
    await feeds.get(id)?.job.resize({ columns, rows });
  },
  /** Whether the shell sits at its prompt, so closing it stops nothing the user started. */
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
    feeds.delete(id);
    void feed?.job.stop().catch(() => undefined);
  },
  retryRender(id: WorkbenchTabId): void {
    update(id, (tab) => (tab.kind === "shell" ? tab : { ...tab, rendering: { kind: "ready" } }));
  },
  /** Closes the tab; a shell tab stops its shell, an agent's tab leaves the job running. */
  async close(id: WorkbenchTabId): Promise<void> {
    const tab = getTerminal(id);

    if (tab !== undefined && tab.kind === "shell") {
      await creating.get(id);
      const feed = feeds.get(id);
      await feed?.job.stop();
      await feed?.job.close();
    }

    remove(id);
  },
};

export function openJobTerminal({
  controller,
  view,
  sessionId,
  job,
}: {
  readonly controller: Pick<WorkbenchController, "actions">;
  readonly view: WorkbenchViewKey;
  readonly sessionId: SessionId;
  readonly job: JobView;
}): WorkbenchTabId {
  const id = controller.actions.openTab({
    view,
    tab: {
      kind: "terminal",
      owner: { kind: "agent", sessionId, jobId: job.id },
    },
    activate: true,
  });

  terminalActions.openJob({ id, sessionId, job });

  return id;
}
