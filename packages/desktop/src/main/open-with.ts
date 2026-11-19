import { stat } from "node:fs/promises";
import { sep } from "node:path";
import type { SelectedWorkspace } from "@nyte-ai/app/contract/bridge.ts";
import type { DesktopWindowOpen } from "@nyte-ai/app/contract/desktop-window.ts";
import type { DesktopHost } from "../host/desktop-host.ts";
import type { HostWindow } from "../shared/host-window.ts";

export interface OpenedPath {
  readonly path: string;
  readonly folder: boolean;
}

export type OpenRoute =
  | { readonly kind: "window"; readonly window: HostWindow }
  | { readonly kind: "new-window" };

/**
 * Opens what the OS hands the app. A file opens from the projects the host listed last, so a busy host can't hold its
 * window back; only a file outside all of them waits for the host's current list.
 */
export function createOpenWith(options: {
  host: () => DesktopHost;
  windows: () => readonly HostWindow[];
  workspace: (window: HostWindow) => string | undefined;
  send: (window: HostWindow, path: string) => void;
  open: (opening: DesktopWindowOpen) => void;
  failed: (path: string, message: string) => void;
}) {
  const pending: string[] = [];
  let ready = false;
  let reachable = false;
  let opening = Promise.resolve();
  let known: readonly SelectedWorkspace[] = [];

  const learn = async (): Promise<readonly SelectedWorkspace[]> => {
    known = await options.host().localWorkspaces();

    return known;
  };

  const openPath = async (path: string): Promise<void> => {
    const stats = await stat(path);
    const host = options.host();

    const roots = options.windows().flatMap((window) => {
      const root = options.workspace(window);

      return root === undefined ? [] : [{ window, root }];
    });

    const route = routeOpenedPath({ path, folder: stats.isDirectory() }, roots);

    if (route.kind === "window") options.send(route.window, path);
    else if (stats.isDirectory()) await openFolder(host, path);
    else await openFile(path);
    void learn().catch(() => undefined);
  };

  const openFolder = async (host: DesktopHost, path: string): Promise<void> => {
    const registered = await host.registerWorkspace(path);

    if (registered.kind === "failed") options.failed(path, registered.message);
    else options.open({ kind: "folder", workspace: registered.workspace });
  };

  const openFile = async (path: string): Promise<void> => {
    const workspace = owningWorkspace(path, known) ?? owningWorkspace(path, await learn());
    options.open({ kind: "file", path, workspace });
  };

  const openSoon = (): void => {
    if (!ready || !reachable) return;

    for (const path of pending.splice(0))
      opening = opening.then(() =>
        openPath(path).catch((cause: unknown) =>
          options.failed(path, cause instanceof Error ? cause.message : String(cause)),
        ),
      );
  };

  return {
    add(path: string): void {
      pending.push(path);
      openSoon();
    },
    ready(): void {
      ready = true;
      openSoon();
    },
    reachable(connected: boolean): void {
      reachable = connected;

      if (connected) void learn().catch(() => undefined);
      openSoon();
    },
  };
}

export function routeOpenedPath(
  opened: OpenedPath,
  windows: readonly { readonly window: HostWindow; readonly root: string }[],
): OpenRoute {
  if (opened.folder) return { kind: "new-window" };
  const owner = deepestRoot(opened.path, windows);

  return owner === undefined ? { kind: "new-window" } : { kind: "window", window: owner.window };
}

function owningWorkspace(
  path: string,
  workspaces: readonly SelectedWorkspace[],
): SelectedWorkspace | undefined {
  return deepestRoot(
    path,
    workspaces.map((workspace) => ({ workspace, root: workspace.path })),
  )?.workspace;
}

function deepestRoot<Candidate extends { readonly root: string }>(
  path: string,
  candidates: readonly Candidate[],
): Candidate | undefined {
  return candidates.reduce<Candidate | undefined>(
    (best, candidate) =>
      path.startsWith(candidate.root.endsWith(sep) ? candidate.root : `${candidate.root}${sep}`) &&
      (best === undefined || candidate.root.length >= best.root.length)
        ? candidate
        : best,
    undefined,
  );
}
