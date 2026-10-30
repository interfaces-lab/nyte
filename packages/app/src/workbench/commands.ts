import type { JobView, WorkspaceId } from "@nyte-ai/sdk";
import { clientCapabilities } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { mentionsFolder } from "../references/message-references.ts";
import type { ReferenceOpener } from "../references/reference-opener.tsx";
import { fileActions } from "./files/file-store.ts";
import { matchingTab, WORKBENCH_KINDS } from "./model.ts";
import type {
  KindInput,
  LaunchKind,
  WorkbenchChangesScope,
  WorkbenchTabId,
  WorkbenchViewKey,
} from "./model.ts";
import { workbenchScope, workspacePathForView } from "./paths.ts";
import { workbench } from "./store.ts";
import { getTerminal, terminalActions } from "./terminal/terminal-store.ts";

/**
 * Opens a kind from a launcher: a singleton kind's open tab, or a new tab, following the kind's
 * launch policy. A new Terminal starts its shell.
 */
export function launch(view: WorkbenchViewKey, kind: LaunchKind): void {
  const descriptor = WORKBENCH_KINDS[kind];
  const workspacePath = workspacePathForView(view);

  if (!descriptor.available(workbenchScope(workspacePath), clientCapabilities(nyte.host))) return;
  const tab = { id: crypto.randomUUID(), ...descriptor.launch.input };

  workbench.dispatch(
    view,
    descriptor.launch.policy === "singleton"
      ? { kind: "open", tab, activate: true }
      : { kind: "add", tab },
  );

  if (tab.kind === "terminal")
    void terminalActions.create({ id: tab.id, workspacePath: workspacePath ?? null });
}

export function openUrl(view: WorkbenchViewKey, url: string, activate = true): void {
  workbench.dispatch(view, {
    kind: "open",
    tab: { id: crypto.randomUUID(), kind: "browser", url, surface: null },
    activate,
  });
}

/** Shows Changes at `scope`, revealing `path` when it names one. */
export function openChanges(
  view: WorkbenchViewKey,
  scope: WorkbenchChangesScope,
  path: string | null,
): void {
  workbench.dispatch(view, { kind: "open-changes", id: crypto.randomUUID(), scope, path });
}

/** Opens an agent's job in a read-only terminal tab, or focuses the tab already showing it. */
export function openJobTerminal(
  view: WorkbenchViewKey,
  workspace: WorkspaceId,
  job: JobView,
): WorkbenchTabId {
  const input = { kind: "terminal", owner: { kind: "job", workspace, job: job.id } } as const;
  const id = matchingTab(workbench.getView(view).tabs, input)?.id ?? crypto.randomUUID();
  workbench.dispatch(view, { kind: "open", tab: { id, ...input }, activate: true });
  terminalActions.openJob({ id, workspace, job });

  return id;
}

type CloseOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "confirm"; readonly reason: "dirty" | "running" };

/**
 * Closes a tab, or says what the user has to confirm first: a file's unsaved edits, or a shell
 * that is still running something. A confirmed shell closes with {@link endTerminal}; a dirty
 * file waits in the file store's pending close. A failed idle check rejects, and the caller
 * asks before ending the shell.
 */
export async function closeTab(view: WorkbenchViewKey, id: WorkbenchTabId): Promise<CloseOutcome> {
  const tab = workbench.getView(view).tabs.find((candidate) => candidate.id === id);

  if (tab?.kind === "file")
    return fileActions.close(view, tab.path)
      ? { kind: "closed" }
      : { kind: "confirm", reason: "dirty" };

  const terminal = tab?.kind === "terminal" ? getTerminal(id) : undefined;

  if (
    terminal?.kind === "shell" &&
    terminal.state.kind === "running" &&
    !(await terminalActions.idle(id))
  )
    return { kind: "confirm", reason: "running" };

  if (terminal !== undefined) {
    await endTerminal(view, id);

    return { kind: "closed" };
  }

  workbench.dispatch(view, { kind: "close", id });

  return { kind: "closed" };
}

/** Ends a terminal's shell or detaches its job, then closes its tab. */
export async function endTerminal(view: WorkbenchViewKey, id: WorkbenchTabId): Promise<void> {
  await terminalActions.close(id);
  workbench.dispatch(view, { kind: "close", id });
}

/** Turns a chat's references into workbench opens: files, URLs, canvases and Changes. */
export function workbenchReferenceOpener(view: WorkbenchViewKey): ReferenceOpener {
  const workspacePath = workspacePathForView(view);

  return (reference) => {
    if (reference.kind === "url") return () => openUrl(view, reference.url);

    if (reference.kind === "canvas") {
      const tab: KindInput<"canvas"> = {
        kind: "canvas",
        sessionId: reference.sessionId,
        part: reference.part,
        title: reference.title,
        pinned: null,
      };

      return () =>
        workbench.dispatch(view, {
          kind: "open",
          tab: { id: crypto.randomUUID(), ...tab },
          activate: true,
        });
    }

    if (workspacePath === undefined) return undefined;

    switch (reference.kind) {
      case "file": {
        const file = reference.file;

        if (mentionsFolder(file)) return () => fileActions.reveal(view, file.displayPath);

        return () =>
          fileActions.open(view, { path: file.path, line: reference.lines?.start, preview: true });
      }

      case "skill":
        return () => fileActions.open(view, { path: reference.path, preview: true });
      case "excerpt": {
        const source = reference.source;

        if (source.kind === "browser") return () => openUrl(view, source.url);

        if (source.kind !== "diff" || source.side === "old") return undefined;
        const path = `${workspacePath.replace(/\/$/u, "")}/${source.path}`;

        return () => fileActions.open(view, { path, line: source.start, preview: true });
      }

      case "changes":
        return () => openChanges(view, { kind: "thread" }, reference.path);
      case "mention":
      case "clipboard":
        return undefined;
      default: {
        const exhaustive: never = reference;

        return exhaustive;
      }
    }
  };
}
