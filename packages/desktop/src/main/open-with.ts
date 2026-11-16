import { stat } from "node:fs/promises";
import { sep } from "node:path";
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

const BATCH_MS = 100;

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
  let batch: ReturnType<typeof setTimeout> | undefined;

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
    else await openFile(host, path);
  };

  const openFolder = async (host: DesktopHost, path: string): Promise<void> => {
    const registered = await host.registerWorkspace(path);

    if (registered.kind === "failed") options.failed(path, registered.message);
    else options.open({ kind: "folder", workspace: registered.workspace });
  };

  const openFile = async (host: DesktopHost, path: string): Promise<void> => {
    const known = (await host.localWorkspaces()).map((workspace) => ({
      workspace,
      root: workspace.path,
    }));

    const workspace = deepestRoot(path, known)?.workspace;
    options.open({ kind: "file", path, workspace });
  };

  const openSoon = (): void => {
    if (!ready || !reachable || pending.length === 0) return;
    clearTimeout(batch);
    batch = setTimeout(() => {
      if (!reachable) return;

      void pending
        .splice(0)
        .reduce(
          (opened, path) =>
            opened.then(() =>
              openPath(path).catch((cause: unknown) =>
                options.failed(path, cause instanceof Error ? cause.message : String(cause)),
              ),
            ),
          Promise.resolve(),
        );
    }, BATCH_MS);
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
