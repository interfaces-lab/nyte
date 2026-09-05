import { useSyncExternalStore } from "react";
import { toast } from "@nyte-ai/ui/sonner";
import type { HostEvent } from "../../../shared/ipc.ts";
import { errorMessage } from "../../../shared/errors.ts";
import { nyte } from "../nyte.ts";

export type TerminalState =
  | { readonly kind: "starting" }
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "failed"; readonly message: string };

export interface TerminalTab {
  readonly id: string;
  readonly owner: string;
  readonly title: string;
  readonly cwd: string;
  readonly state: TerminalState;
}

export interface TerminalOutput {
  write(data: string): void;
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

export interface OwnerTerminals {
  readonly tabs: readonly TerminalTab[];
  readonly activeId: string | null;
}

export function useTerminals(owner: string): OwnerTerminals {
  const current = useSyncExternalStore(subscribe, getSnapshot);
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

export function attachTerminalOutput(id: string, sink: TerminalOutput): void {
  output.set(id, sink);
  for (const data of queued.get(id) ?? []) sink.write(data);
  queued.delete(id);
}

export function applyTerminalEvent(
  event: Extract<HostEvent, { kind: "terminal_data" | "terminal_exit" }>,
): void {
  if (getTerminal(event.id) === undefined) return;
  if (event.kind === "terminal_exit") {
    update(event.id, (tab) => ({ ...tab, state: { kind: "exited", exitCode: event.exitCode } }));
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

export const terminalActions = {
  create(owner: string, workspacePath: string | null): Promise<void> {
    const id = crypto.randomUUID();
    publish(
      [
        ...snapshot.tabs,
        { id, owner, title: "Terminal", cwd: workspacePath ?? "", state: { kind: "starting" } },
      ],
      new Map(snapshot.active).set(owner, id),
    );
    const pending = nyte.host.terminal
      .create({ id, workspacePath })
      .then((info) => {
        update(id, (tab) => ({
          ...tab,
          ...info,
          state: tab.state.kind === "starting" ? { kind: "running" } : tab.state,
        }));
      })
      .catch((cause: unknown) => {
        const message = errorMessage(cause);
        update(id, (tab) => ({ ...tab, state: { kind: "failed", message } }));
        toast.error("Couldn't start terminal", { description: message });
      })
      .finally(() => creating.delete(id));
    creating.set(id, pending);
    return pending;
  },
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
    if (clean === "" || getTerminal(id)?.title === clean) return;
    update(id, (tab) => ({ ...tab, title: clean }));
  },
  fail(id: string, message: string): void {
    update(id, (tab) => ({ ...tab, state: { kind: "failed", message } }));
    void nyte.host.terminal.close({ id }).catch(() => undefined);
  },
  async close(id: string): Promise<void> {
    await creating.get(id);
    await nyte.host.terminal.close({ id });
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
  },
};
