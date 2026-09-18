import type { JobInfo, SessionId } from "@nyte-ai/protocol";
import { toast } from "@nyte-ai/ui/sonner";
import { useSyncExternalStore } from "react";
import { errorMessage } from "../../../shared/errors.ts";
import type { HostEvent } from "../../../shared/ipc.ts";
import { nyte } from "../nyte.ts";

export type CommandJobInfo = Extract<JobInfo, { readonly kind: "command" }>;

type ShellTerminalState =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "failed"; readonly message: string };

type JobTerminalState = { readonly kind: CommandJobInfo["state"] };

type TerminalRenderingState =
  | { readonly kind: "ready" }
  | { readonly kind: "failed"; readonly message: string };

interface TerminalTabFields {
  readonly id: string;
  readonly owner: string;
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
    readonly jobId: CommandJobInfo["id"];
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
  readonly tabs: readonly TerminalTab[];
  readonly active: ReadonlyMap<string, string>;
}

let snapshot: TerminalSnapshot = { tabs: [], active: new Map() };
const listeners = new Set<() => void>();
const output = new Map<string, TerminalOutput>();
const queued = new Map<string, string[]>();
const creating = new Map<string, Promise<void>>();

function publish(tabs: readonly TerminalTab[], active = snapshot.active): void {
  snapshot = { tabs, active };
  for (const listener of listeners) listener();
}

function update(id: string, change: (tab: TerminalTab) => TerminalTab): void {
  const tabs = snapshot.tabs.map((tab) => {
    if (tab.id !== id) return tab;
    const next = change(tab);
    output.get(id)?.update(next);
    return next;
  });
  publish(tabs);
}

function getSnapshot(): TerminalSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface OwnerTerminals {
  readonly tabs: readonly TerminalTab[];
  readonly activeId: string | null;
}

export function useTerminals(owner: string): OwnerTerminals {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const owned = current.tabs.filter((tab) => tab.owner === owner);
  const id = current.active.get(owner);
  return { tabs: owned, activeId: owned.find((tab) => tab.id === id)?.id ?? owned[0]?.id ?? null };
}

export function getTerminal(id: string): TerminalTab | undefined {
  return snapshot.tabs.find((tab) => tab.id === id);
}

export function getTerminals(owner: string): readonly TerminalTab[] {
  return snapshot.tabs.filter((tab) => tab.owner === owner);
}

export function getActiveTerminal(owner: string): TerminalTab | undefined {
  const owned = getTerminals(owner);
  const id = snapshot.active.get(owner);
  return owned.find((tab) => tab.id === id) ?? owned[0];
}

export function getJobTerminal(
  owner: string,
  sessionId: SessionId,
  jobId: CommandJobInfo["id"],
): JobTerminalTab | undefined {
  return snapshot.tabs.find(
    (tab): tab is JobTerminalTab =>
      isJobTerminal(tab) &&
      tab.owner === owner &&
      tab.source.sessionId === sessionId &&
      tab.source.jobId === jobId,
  );
}

export function attachTerminalOutput(id: string, sink: TerminalOutput): void {
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

function writeJobOutput(id: string, previous: string, next: string): void {
  if (previous === next) return;
  const sink = output.get(id);
  if (sink === undefined) return;
  if (next.startsWith(previous)) {
    sink.write(next.slice(previous.length));
    return;
  }
  // Jobs publish bounded snapshots, not byte offsets. A replacement may also share a suffix.
  sink.replace(next);
}

function syncJobs(owner: string, sessionId: SessionId, jobs: readonly JobInfo[]): void {
  const commands = new Map<CommandJobInfo["id"], CommandJobInfo>();
  for (const job of jobs) {
    if (job.kind === "command") commands.set(job.id, job);
  }
  let changed = false;
  const tabs = snapshot.tabs.map((tab): TerminalTab => {
    if (!isJobTerminal(tab) || tab.owner !== owner || tab.source.sessionId !== sessionId)
      return tab;
    const job = commands.get(tab.source.jobId);
    if (job === undefined) return tab;
    if (
      tab.title === job.title &&
      tab.state.kind === job.state &&
      tab.source.output === job.output
    ) {
      return tab;
    }
    changed = true;
    const next: JobTerminalTab = {
      ...tab,
      title: job.title,
      source: { ...tab.source, output: job.output },
      state: { kind: job.state },
    };
    output.get(tab.id)?.update(next);
    writeJobOutput(tab.id, tab.source.output, job.output);
    return next;
  });
  if (changed) publish(tabs);
}

function remove(id: string): void {
  const index = snapshot.tabs.findIndex((tab) => tab.id === id);
  const tab = snapshot.tabs[index];
  output.get(id)?.dispose();
  output.delete(id);
  queued.delete(id);
  const tabs = snapshot.tabs.filter((entry) => entry.id !== id);
  const active = new Map(snapshot.active);
  if (tab !== undefined && active.get(tab.owner) === id) {
    const neighbor =
      tabs.slice(0, index).findLast((entry) => entry.owner === tab.owner) ??
      tabs.find((entry) => entry.owner === tab.owner);
    if (neighbor === undefined) active.delete(tab.owner);
    else active.set(tab.owner, neighbor.id);
  }
  publish(tabs, active);
}

export const terminalActions = {
  create(owner: string, workspacePath: string | null): Promise<void> {
    const id = crypto.randomUUID();
    publish(
      [
        ...snapshot.tabs,
        {
          id,
          owner,
          title: "Terminal",
          cwd: workspacePath ?? "",
          source: { kind: "shell" },
          state: { kind: "starting" },
        },
      ],
      new Map(snapshot.active).set(owner, id),
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
  openJob(owner: string, sessionId: SessionId, job: CommandJobInfo): string {
    const existing = getJobTerminal(owner, sessionId, job.id);
    if (existing !== undefined) {
      syncJobs(owner, sessionId, [job]);
      publish(snapshot.tabs, new Map(snapshot.active).set(owner, existing.id));
      return existing.id;
    }
    const id = crypto.randomUUID();
    publish(
      [
        ...snapshot.tabs,
        {
          id,
          owner,
          title: job.title,
          cwd: "",
          source: { kind: "job", sessionId, jobId: job.id, output: job.output },
          state: { kind: job.state },
          rendering: { kind: "ready" },
        },
      ],
      new Map(snapshot.active).set(owner, id),
    );
    return id;
  },
  syncJobs,
  select(owner: string, id: string): void {
    if (!snapshot.tabs.some((tab) => tab.id === id && tab.owner === owner)) return;
    publish(snapshot.tabs, new Map(snapshot.active).set(owner, id));
  },
  title(id: string, title: string): void {
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
  fail(id: string, message: string): void {
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
  retryRender(id: string): void {
    update(id, (tab) => {
      if (isShellTerminal(tab)) return tab;
      return { ...tab, rendering: { kind: "ready" } };
    });
  },
  async close(id: string): Promise<void> {
    const tab = getTerminal(id);
    if (tab !== undefined && isJobTerminal(tab)) {
      // Closing an agent-controlled workbench binding does not dispose its process.
      remove(id);
      return;
    }
    await creating.get(id);
    await nyte.host.terminal.close({ id });
    remove(id);
  },
};
