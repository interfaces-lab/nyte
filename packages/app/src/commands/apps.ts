import { Value } from "typebox/value";
import type { HostState } from "../contract/bridge.ts";
import type { AppSwitch, ArrivalSubject, DesktopWindowOpen } from "../contract/desktop-window.ts";
import { nyte, offeredApps, windowApp } from "../contract/nyte.ts";
import { documentsApi } from "../data/documents.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { commitHostWorkspace } from "../data/workspaces.ts";
import { currentLights, HERE, watchLights } from "../light/light.ts";
import { launch } from "../workbench/commands.ts";
import { EDITOR_SLOT } from "../workbench/model.ts";
import { spanTarget } from "../editor/editor-selection.ts";
import { fileActions } from "../editor/file-store.ts";
import type { FileTarget } from "../editor/file-store.ts";
import { workbenchViewKey } from "../workbench/paths.ts";
import { workbench } from "../workbench/store.ts";

/**
 * Opens or focuses an app on this window's workspace, carrying the person's light. False where the client has one app,
 * or doesn't offer that one.
 */
export function switchApp(to: AppSwitch): boolean {
  const open = nyte.host.switchApp;

  if (open === undefined || (to !== "last" && !offeredApps().includes(to))) return false;

  if (to === windowApp()) return true;

  void open({
    to,
    workspace: queryClient.getQueryData<HostState>(keys.host)?.workspace ?? null,
    subject: currentLights().you?.subject ?? null,
  });

  return true;
}

/**
 * Opens a window on the project a switch or a relaunch named. The first time an app shows a project, Code opens the
 * Editor with its explorer and the chat panel beside it, and Studio opens maximized on Design; after that each app
 * restores its own last arrangement.
 */
export function openAppWindow(open: Extract<DesktopWindowOpen, { kind: "app" }>): void {
  if (open.workspace !== undefined) commitHostWorkspace(open.workspace);
  const view = workbenchViewKey(open.workspace?.path);
  const app = windowApp();
  const fresh = !workbench.getSnapshot().views.has(view);

  if (fresh && app === "code") {
    launch(view, "editor");
    workbench.dispatch(view, { kind: "toggle-sidebar", slot: EDITOR_SLOT });
    workbench.dispatch(view, { kind: "set-width", pixels: CODE_CHAT_WIDTH });
  }

  if (fresh && app === "studio") {
    launch(view, "design");
    workbench.dispatch(view, { kind: "maximize" });
  }

  if (open.subject !== undefined) void landAt(open.subject);
}

const CODE_CHAT_WIDTH = 440;

/**
 * Keeps a Code window's workbench as its main area: whatever project the window shows, the workbench stays open with
 * an Editor in it, so the window never falls back to Nyte's chat-first layout. Closing the last other tab shows the
 * Editor again.
 */
export function keepCodeWorkbench(): () => void {
  const keep = (): void => {
    const view = workbenchViewKey(queryClient.getQueryData<HostState>(keys.host)?.workspace?.path);
    const state = workbench.getView(view);

    if (!state.expanded || !state.tabs.some((tab) => tab.kind === "editor")) launch(view, "editor");
  };

  keep();
  const leaveWorkbench = workbench.subscribe(keep);

  const leaveHost = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] === keys.host[0]) keep();
  });

  return () => {
    leaveWorkbench();
    leaveHost();
  };
}

/**
 * Lands this window on the selection a switch carried. Code opens the file at its range; Studio shows its board, which
 * follows the light. A selection this window made itself is already where the person left it.
 */
export async function landAt(subject: ArrivalSubject): Promise<void> {
  const app = windowApp();
  const view = workbenchViewKey(queryClient.getQueryData<HostState>(keys.host)?.workspace?.path);

  if (app === "studio") launch(view, "design");

  if (app !== "code") return;
  const you = currentLights().you;

  if (you !== null && you.window === HERE && Value.Equal(you.subject, subject)) return;

  fileActions.open(view, { path: subject.path, target: await landingTarget(subject) });
}

/**
 * Keeps a Code window's editor on the light: a selection made in another window, or what an agent changed, opens here at
 * its range. An agent's change waits while the person is in this window: Studio lights their own saves as changes too,
 * and those must never move the caret they are typing at.
 */
export function followLight(): () => void {
  let seen = 0;

  return watchLights(() => {
    const now = currentLights();

    const latest = [...(now.you === null ? [] : [now.you]), ...now.agents].toSorted(
      (left, right) => right.at - left.at,
    )[0];

    if (latest === undefined || latest.at <= seen) return;
    seen = latest.at;

    if ("window" in latest && latest.window === HERE) return;
    void landAt(latest.subject);
  });
}

async function landingTarget(subject: ArrivalSubject): Promise<FileTarget | undefined> {
  if (subject.kind === "file") return undefined;

  const document = await queryClient.fetchQuery({
    queryKey: keys.document(subject.path),
    queryFn: async () => (await documentsApi()).read(subject.path, { as: "document" }),
  });

  return document.kind === "text"
    ? spanTarget(document.contents, subject.start, subject.end)
    : undefined;
}
