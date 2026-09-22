import type { JobInfo, SessionId } from "@nyte-ai/protocol";
import { toast } from "@nyte-ai/ui/sonner";
import { useSyncExternalStore } from "react";
import { errorMessage } from "../../../shared/errors.ts";
import type { HostEvent } from "../../../shared/ipc.ts";
import { nyte } from "../nyte.ts";
import { WORKBENCH_STAGE_PANE_KEY, workbenchViewKey } from "./controller.ts";
import type { WorkbenchController, WorkbenchTabId, WorkbenchViewKey } from "./controller.ts";

type ShellTerminalState =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "failed"; readonly message: string };

type JobTerminalState = { readonly kind: JobInfo["phase"]["kind"] };

type TerminalRenderingState =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly message: string };

interface TerminalTabFields {
  readonly id: WorkbenchTabId;
  readonly title: string;
  readonly cwd: string;
}

interface ShellTerminalTab extends TerminalTabFields {
  readonly source: { readonly kind: "shell" };
  readonly state: ShellTerminalState;
}

interface JobTerminalTab extends TerminalTabFields {
  readonly source: {
    readonly kind: "job";
    readonly sessionId: SessionId;
    readonly jobId: JobInfo["id"];
    readonly output: string;
  };
  readonly state: JobTerminalState;
  readonly rendering: TerminalRenderingState;
}

export type TerminalTab = ShellTerminalTab | JobTerminalTab;

export function isShellTerminal(tab: TerminalTab): tab is ShellTerminalTab {
  return tab.source.kind === "shell";
}

export function isJobTerminal(tab: TerminalTab): tab is JobTerminalTab {
  return tab.source.kind === "job";
}

export interface TerminalOutput {
  write(data: string): void;
  replace(data: string): void;
  update(tab: TerminalTab): void;
  dispose(): void;
}

interface TerminalSnapshot {
  readonly tabs: ReadonlyMap<WorkbenchTabId, TerminalTab>;
}

let snapshot: TerminalSnapshot = { tabs: new Map() };

const listeners = new Set<() => void>();

const output = new Map<WorkbenchTabId, TerminalOutput>();

const queued = new Map<WorkbenchTabId, string[]>();

const creating = new Map<WorkbenchTabId, Promise<void>>();

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

export function useJobTerminals(sessionId: SessionId): readonly TerminalTab[] {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return [...current.tabs.values()].filter(
    (tab) => isJobTerminal(tab) && tab.source.sessionId === sessionId,
  );
}

export function getTerminal(id: WorkbenchTabId): TerminalTab | undefined {
  return snapshot.tabs.get(id);
}

export function getJobTerminal(jobId: JobInfo["id"]): JobTerminalTab | undefined {
  return [...snapshot.tabs.values()].find(
    (tab): tab is JobTerminalTab => isJobTerminal(tab) && tab.source.jobId === jobId,
  );
}

export function attachTerminalOutput(id: WorkbenchTabId, sink: TerminalOutput): void {
  output.set(id, sink);
  const tab = getTerminal(id);

  if (tab !== undefined && isJobTerminal(tab)) {
    if (tab.source.output !== "") sink.write(tab.source.output);

    return;
  }

  for (const data of queued.get(id) ?? []) sink.write(data);
  queued.delete(id);
}

export function applyTerminalEvent(
  event: Extract<HostEvent, { kind: "terminal_data" | "terminal_exit" }>,
): void {
  const tab = getTerminal(event.id);

  if (tab === undefined || isJobTerminal(tab)) return;

  if (event.kind === "terminal_exit") {
    update(event.id, (current) => {
      if (isJobTerminal(current)) return current;

      return { ...current, state: { kind: "exited", exitCode: event.exitCode } };
    });

    return;
  }

  const sink = output.get(event.id);

  if (sink !== undefined) sink.write(event.data);
  else {
    const pending = queued.get(event.id) ?? [];
    pending.push(event.data);
    queued.set(event.id, pending);
  }
}

function writeJobOutput(id: WorkbenchTabId, previous: string, next: string): void {
  if (previous === next) return;
  const sink = output.get(id);

  if (sink === undefined) return;

  if (next.startsWith(previous)) {
    sink.write(next.slice(previous.length));

    return;
  }

  sink.replace(next);
}

function syncJobs(sessionId: SessionId, jobs: readonly JobInfo[]): void {
  const commands = new Map(jobs.map((job) => [job.id, job]));
  const tabs = new Map(snapshot.tabs);
  let changed = false;

  for (const tab of snapshot.tabs.values()) {
    if (!isJobTerminal(tab) || tab.source.sessionId !== sessionId) continue;
    const job = commands.get(tab.source.jobId);

    if (job === undefined) continue;

    if (
      tab.title === job.command &&
      tab.state.kind === job.phase.kind &&
      tab.source.output === job.output
    ) {
      continue;
    }

    changed = true;

    const next: JobTerminalTab = {
      ...tab,
      title: job.command,
      source: { ...tab.source, output: job.output },
      state: { kind: job.phase.kind },
    };

    tabs.set(tab.id, next);
    output.get(tab.id)?.update(next);
    writeJobOutput(tab.id, tab.source.output, job.output);
  }

  if (changed) publish(tabs);
}

function remove(id: WorkbenchTabId): void {
  output.get(id)?.dispose();
  output.delete(id);
  queued.delete(id);
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
    publish(
      new Map(snapshot.tabs).set(id, {
        id,
        title: "Terminal",
        cwd: workspacePath ?? "",
        source: { kind: "shell" },
        state: { kind: "starting" },
      }),
    );

    const pending = nyte.host.terminal
      .create({ id, workspacePath })
      .then((info) => {
        update(id, (tab) => {
          if (isJobTerminal(tab)) return tab;

          return {
            ...tab,
            ...info,
            state: tab.state.kind === "starting" ? { kind: "running" } : tab.state,
          };
        });
      })
      .catch((cause: unknown) => {
        const message = errorMessage(cause);
        update(id, (tab) => {
          if (isJobTerminal(tab)) return tab;

          return { ...tab, state: { kind: "failed", message } };
        });
        toast.error("Couldn't start terminal", { description: message });
      })
      .finally(() => creating.delete(id));

    creating.set(id, pending);

    return pending;
  },
  openJob({
    id,
    sessionId,
    job,
  }: {
    readonly id: WorkbenchTabId;
    readonly sessionId: SessionId;
    readonly job: JobInfo;
  }): void {
    const existing = snapshot.tabs.get(id);

    if (existing !== undefined && isJobTerminal(existing)) {
      syncJobs(sessionId, [job]);

      return;
    }

    publish(
      new Map(snapshot.tabs).set(id, {
        id,
        title: job.command,
        cwd: "",
        source: { kind: "job", sessionId, jobId: job.id, output: job.output },
        state: { kind: job.phase.kind },
        rendering: { kind: "ready" },
      }),
    );
  },
  syncJobs,
  title(id: WorkbenchTabId, title: string): void {
    const clean = Array.from(title)
      .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
      .join("")
      .trim()
      .slice(0, 160);

    const tab = getTerminal(id);

    if (tab === undefined || isJobTerminal(tab) || clean === "" || tab.title === clean) return;
    update(id, (current) => {
      if (isJobTerminal(current)) return current;

      return { ...current, title: clean };
    });
  },
  fail(id: WorkbenchTabId, message: string): void {
    const tab = getTerminal(id);

    if (tab === undefined) return;

    if (isJobTerminal(tab)) {
      update(id, (current) => {
        if (isShellTerminal(current)) return current;

        return { ...current, rendering: { kind: "failed", message } };
      });

      return;
    }

    update(id, (current) => {
      if (isJobTerminal(current)) return current;

      return { ...current, state: { kind: "failed", message } };
    });
    void nyte.host.terminal.close({ id }).catch(() => undefined);
  },
  retryRender(id: WorkbenchTabId): void {
    update(id, (tab) => {
      if (isShellTerminal(tab)) return tab;

      return { ...tab, rendering: { kind: "ready" } };
    });
  },
  async close(id: WorkbenchTabId): Promise<void> {
    const tab = getTerminal(id);

    if (tab !== undefined && isJobTerminal(tab)) {
      remove(id);

      return;
    }

    await creating.get(id);
    await nyte.host.terminal.close({ id });
    remove(id);
  },
};

export function openSessionJobTerminal({
  controller,
  displayedSessionId,
  jobSessionId,
  job,
  activate,
}: {
  readonly controller: Pick<WorkbenchController, "actions">;
  readonly displayedSessionId: SessionId;
  readonly jobSessionId: SessionId;
  readonly job: JobInfo;
  readonly activate: boolean;
}): WorkbenchTabId {
  return openJobTerminal({
    controller,
    view: workbenchViewKey({
      paneKey: WORKBENCH_STAGE_PANE_KEY,
      target: { kind: "session", sessionId: displayedSessionId },
    }),
    sessionId: jobSessionId,
    job,
    activate,
  });
}

export function openJobTerminal({
  controller,
  view,
  sessionId,
  job,
  activate,
}: {
  readonly controller: Pick<WorkbenchController, "actions">;
  readonly view: WorkbenchViewKey;
  readonly sessionId: SessionId;
  readonly job: JobInfo;
  readonly activate: boolean;
}): WorkbenchTabId {
  const id = controller.actions.openTab({
    view,
    tab: {
      kind: "terminal",
      owner: { kind: "agent", sessionId, jobId: job.id },
    },
    activate,
  });

  terminalActions.openJob({ id, sessionId, job });

  return id;
}
