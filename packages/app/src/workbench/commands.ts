import type { JobView, WorkspaceId } from "@nyte-ai/sdk";
import type { HostState } from "../contract/bridge.ts";
import { clientCapabilities } from "../contract/client-actions.ts";
import type { DesktopApp } from "../contract/desktop-app.ts";
import type { ArrivalSubject } from "../contract/desktop-window.ts";
import { nyte, windowApp } from "../contract/nyte.ts";
import { documentsApi } from "../data/documents.ts";
import { keys, queryClient } from "../data/query-client.ts";
import type { ReferenceOpener } from "../references/reference-opener.tsx";
import { fileActions } from "./editor/file-store.ts";
import { EDITOR_SLOT, FOLLOW_BROWSE, matchingTab, tabSlot, WORKBENCH_KINDS } from "./model.ts";
import type {
  KindInput,
  LaunchKind,
  WorkbenchChangesScope,
  WorkbenchTabId,
  WorkbenchViewKey,
} from "./model.ts";
import { workbenchScope, workspacePathForView } from "./paths.ts";
import { shownWorkbenchTab } from "./selectors.ts";
import { workbench } from "./store.ts";
import { getTerminal, terminalActions } from "./terminal/terminal-store.ts";

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

/** Shows or hides a Code window's explorer. Another tab covering the Editor gives way to it with the explorer open. */
export function toggleExplorer(view: WorkbenchViewKey): void {
  const state = workbench.getView(view);

  const shown = shownWorkbenchTab(
    state,
    workbenchScope(workspacePathForView(view)),
    clientCapabilities(nyte.host),
  );

  const open = state.sidebars.includes(EDITOR_SLOT);

  if (shown !== null && tabSlot(shown) === EDITOR_SLOT) {
    workbench.dispatch(view, { kind: "toggle-sidebar", slot: EDITOR_SLOT });

    return;
  }

  launch(view, "editor");

  if (!open) workbench.dispatch(view, { kind: "toggle-sidebar", slot: EDITOR_SLOT });
}

/** Shows a Code window's chat panel: beside the editor, or in its place where the window is too narrow for both. */
export function revealChatPanel(view: WorkbenchViewKey): void {
  const layout = workbench.getView(view).layout;

  if (layout.kind === "maximized")
    workbench.dispatch(view, { kind: layout.narrow ? "show-chat" : "toggle-maximized" });
}

export function openUrl(view: WorkbenchViewKey, url: string, activate = true): void {
  workbench.dispatch(view, {
    kind: "open",
    tab: { id: crypto.randomUUID(), kind: "browser", url, surface: null },
    activate,
  });
}

export function openChanges(
  view: WorkbenchViewKey,
  scope: WorkbenchChangesScope,
  path: string | null,
): void {
  workbench.dispatch(view, { kind: "browse", root: FOLLOW_BROWSE });
  workbench.dispatch(view, { kind: "open-changes", id: crypto.randomUUID(), scope, path });
}

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

export async function closeTab(view: WorkbenchViewKey, id: WorkbenchTabId): Promise<CloseOutcome> {
  if (id === EDITOR_SLOT) return closeEditor(view);

  const tab = workbench.getView(view).tabs.find((candidate) => candidate.id === id);

  if (tab?.kind === "file")
    return fileActions.close(view, tab.id)
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

function closeEditor(view: WorkbenchViewKey): CloseOutcome {
  const files = workbench.getView(view).tabs.filter((tab) => tab.kind === "file");
  const closed = files.map((tab) => fileActions.close(view, tab.id));
  const kept = files[closed.indexOf(false)];

  if (kept !== undefined) {
    workbench.dispatch(view, { kind: "activate", id: kept.id });

    return { kind: "confirm", reason: "dirty" };
  }

  for (const tab of workbench.getView(view).tabs)
    if (tab.kind === "editor") workbench.dispatch(view, { kind: "close", id: tab.id });

  return { kind: "closed" };
}

export async function endTerminal(view: WorkbenchViewKey, id: WorkbenchTabId): Promise<void> {
  await terminalActions.close(id);
  workbench.dispatch(view, { kind: "close", id });
}

interface Lines {
  readonly start: number;
  readonly end: number;
}

/** Focuses an app's window on this window's workspace, or opens one beside this window, and lands it on the subject. */
export function openInApp(to: DesktopApp, subject: ArrivalSubject | null): void {
  void nyte.host.switchApp?.({
    to,
    workspace: queryClient.getQueryData<HostState>(keys.host)?.workspace ?? null,
    subject,
  });
}

/** Opens what a reference in a chat names. A Studio window has no editor, so it opens files in Code. */
export function workbenchReferenceOpener(view: WorkbenchViewKey): ReferenceOpener {
  const workspacePath = workspacePathForView(view);
  const studio = windowApp() === "studio";

  const openFile = (path: string, lines: Lines | undefined): (() => void) =>
    studio
      ? () => void linkSubject(path, lines).then((subject) => openInApp("code", subject))
      : () =>
          fileActions.open(view, {
            path,
            target: lines === undefined ? undefined : lineTarget(lines),
            preview: true,
          });

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

        if (file.kind === "folder" && studio) return () => openInApp("code", null);

        if (file.kind === "folder")
          return () => {
            workbench.dispatch(view, { kind: "browse", root: FOLLOW_BROWSE });
            fileActions.reveal(view, file.displayPath);
          };

        return openFile(file.path, reference.lines);
      }

      case "skill":
        return openFile(reference.path, undefined);
      case "excerpt": {
        const source = reference.source;

        if (source.kind === "browser") return () => openUrl(view, source.url);

        if (source.kind !== "diff" || source.side === "old") return undefined;

        return openFile(`${workspacePath.replace(/\/$/u, "")}/${source.path}`, source);
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

function lineTarget(lines: Lines) {
  return lines.start === lines.end
    ? { kind: "position" as const, line: lines.start }
    : { kind: "lines" as const, lines: { start: lines.start, end: lines.end } };
}

async function linkSubject(path: string, lines: Lines | undefined): Promise<ArrivalSubject> {
  if (lines === undefined) return { kind: "file", path };
  const document = await (await documentsApi()).read(path, { as: "document" });

  if (document.kind !== "text") return { kind: "file", path };
  const rows = document.contents.split("\n");
  const first = Math.max(lines.start, 1) - 1;
  const start = rows.slice(0, first).reduce((offset, row) => offset + row.length + 1, 0);

  return {
    kind: "span",
    path,
    start,
    end: start + rows.slice(first, Math.max(lines.end, first + 1)).join("\n").length,
  };
}
