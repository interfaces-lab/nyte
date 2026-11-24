import { Value } from "typebox/value";
import type { HostState } from "../contract/bridge.ts";
import type { AppSwitch, ArrivalSubject, DesktopWindowOpen } from "../contract/desktop-window.ts";
import { nyte, offeredApps, windowApp } from "../contract/nyte.ts";
import { documentsApi } from "../data/documents.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { commitHostWorkspace } from "../data/workspaces.ts";
import { currentLights, HERE, watchLights } from "../light/light.ts";
import { launch } from "./launch.ts";
import { spanTarget } from "../editor/editor-selection.ts";
import { fileActions } from "../editor/file-store.ts";
import type { FileTarget } from "../editor/file-store.ts";
import { appShape } from "../workbench/app-shape.ts";
import { workbenchViewKey } from "../workbench/paths.ts";

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

/** Opens a window on the project a switch or a relaunch named, and lands it on the selection the switch carried. */
export function openAppWindow(open: Extract<DesktopWindowOpen, { kind: "app" }>): void {
  if (open.workspace !== undefined) commitHostWorkspace(open.workspace);

  if (open.subject !== undefined) void landAt(open.subject);
}

/**
 * Lands this window on the selection a switch carried, as its app's arrival says: the Editor opens the file at its
 * range, and the Design board shows, which follows the light itself. A selection this window made is already where
 * the person left it.
 */
export async function landAt(subject: ArrivalSubject): Promise<void> {
  const arrival = appShape().arrival;
  const view = workbenchViewKey(queryClient.getQueryData<HostState>(keys.host)?.workspace?.path);

  if (arrival === "design") launch(view, "design");

  if (arrival !== "file") return;
  const you = currentLights().you;

  if (you !== null && you.window === HERE && Value.Equal(you.subject, subject)) return;

  fileActions.open(view, { path: subject.path, target: await landingTarget(subject) });
}

/**
 * Keeps the editor on the light: a selection made in another window, or what an agent changed, opens here at
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
