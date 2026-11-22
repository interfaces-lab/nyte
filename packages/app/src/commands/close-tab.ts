import { errorMessage } from "../contract/errors.ts";
import { fileActions } from "../editor/file-store.ts";
import { EDITOR_SLOT } from "../workbench/model.ts";
import type { WorkbenchTab, WorkbenchTabId, WorkbenchViewKey } from "../workbench/model.ts";
import { workbench } from "../workbench/store.ts";
import { getTerminal, terminalActions } from "../terminal/terminal-store.ts";

type CloseOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "confirm"; readonly reason: "dirty" | "running" };

/** A workbench tab close that waits on the person, because the tab's terminal is still running a process. */
export type TerminalClose =
  | { readonly kind: "closed" }
  | {
      readonly kind: "confirming";
      readonly view: WorkbenchViewKey;
      readonly id: WorkbenchTabId;
      readonly error: string | undefined;
    }
  | { readonly kind: "closing"; readonly view: WorkbenchViewKey; readonly id: WorkbenchTabId };

let terminalClose: TerminalClose = { kind: "closed" };

const terminalCloseListeners = new Set<() => void>();

function setTerminalClose(next: TerminalClose): void {
  terminalClose = next;

  for (const notice of terminalCloseListeners) notice();
}

/** The close waiting on the person, read with `useSyncExternalStore`. */
export const pendingTerminalClose = {
  read: (): TerminalClose => terminalClose,
  subscribe: (notice: () => void): (() => void) => {
    terminalCloseListeners.add(notice);

    return () => terminalCloseListeners.delete(notice);
  },
};

/** Closes a workbench tab, the Editor slot or a file. A running terminal, or a close that fails, waits in `pendingTerminalClose` for the person. */
export function closeTab(view: WorkbenchViewKey, id: WorkbenchTabId): Promise<CloseOutcome> {
  if (id === EDITOR_SLOT) return Promise.resolve(closeEditor(view));

  const tab = workbench.getView(view).tabs.find((candidate) => candidate.id === id);

  if (tab?.kind === "file") {
    return Promise.resolve(
      fileActions.close(view, tab.id) ? { kind: "closed" } : { kind: "confirm", reason: "dirty" },
    );
  }

  return closeOtherTab(view, id, tab).then(
    (outcome) => {
      if (outcome.kind === "confirm") {
        setTerminalClose({ kind: "confirming", view, id, error: undefined });
      }

      return outcome;
    },
    (cause: unknown): CloseOutcome => {
      setTerminalClose({ kind: "confirming", view, id, error: errorMessage(cause) });

      return { kind: "confirm", reason: "running" };
    },
  );
}

/** Ends the terminal the person confirmed closing. Resolves true once it has ended, false when it failed and waits again with the error. */
export function confirmTerminalClose(): Promise<boolean> {
  const pending = terminalClose;

  if (pending.kind !== "confirming") return Promise.resolve(false);
  setTerminalClose({ kind: "closing", view: pending.view, id: pending.id });

  return endTerminal(pending.view, pending.id).then(
    () => {
      setTerminalClose({ kind: "closed" });

      return true;
    },
    (cause: unknown) => {
      setTerminalClose({ ...pending, error: errorMessage(cause) });

      return false;
    },
  );
}

export function dismissTerminalClose(): void {
  setTerminalClose({ kind: "closed" });
}

async function closeOtherTab(
  view: WorkbenchViewKey,
  id: WorkbenchTabId,
  tab: WorkbenchTab | undefined,
): Promise<CloseOutcome> {
  const terminal = tab?.kind === "terminal" ? getTerminal(id) : undefined;

  if (
    terminal?.kind === "shell" &&
    terminal.state.kind === "running" &&
    !(await terminalActions.idle(id))
  ) {
    return { kind: "confirm", reason: "running" };
  }

  if (terminal !== undefined) {
    await endTerminal(view, id);

    return { kind: "closed" };
  }

  workbench.dispatch(view, { kind: "close", id });

  return { kind: "closed" };
}

function closeEditor(view: WorkbenchViewKey): CloseOutcome {
  const files = workbench.getView(view).tabs.filter((tab) => tab.kind === "file");
  const closed = files.map((tab) => fileActions.close(view, tab.id));
  const kept = files[closed.indexOf(false)];

  if (kept !== undefined) {
    workbench.dispatch(view, { kind: "activate", id: kept.id });

    return { kind: "confirm", reason: "dirty" };
  }

  for (const tab of workbench.getView(view).tabs) {
    if (tab.kind === "editor") workbench.dispatch(view, { kind: "close", id: tab.id });
  }

  return { kind: "closed" };
}

async function endTerminal(view: WorkbenchViewKey, id: WorkbenchTabId): Promise<void> {
  await terminalActions.close(id);
  workbench.dispatch(view, { kind: "close", id });
}
