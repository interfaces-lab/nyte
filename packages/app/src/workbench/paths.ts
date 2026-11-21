import { useSyncExternalStore } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { homeFolder, subscribeHomeFolder, useHomeFolder } from "../data/workspaces.ts";
import type { WorkbenchScope, WorkbenchViewKey } from "./model.ts";

export const WORKBENCH_HOME_VIEW_KEY: WorkbenchViewKey = "home";

export function workbenchViewKey(workspacePath: string | undefined): WorkbenchViewKey {
  return workspacePath ?? homeFolder()?.path ?? WORKBENCH_HOME_VIEW_KEY;
}

export function useWorkbenchViewKey(workspacePath: string | undefined): WorkbenchViewKey {
  const read = (): WorkbenchViewKey => workbenchViewKey(workspacePath);

  return useSyncExternalStore(subscribeHomeFolder, read, read);
}

export function useWorkbenchFolder(
  folder: SelectedWorkspace | undefined,
): SelectedWorkspace | undefined {
  const home = useHomeFolder();

  return folder ?? home;
}

export function workspacePathForView(key: WorkbenchViewKey): string | undefined {
  return key === WORKBENCH_HOME_VIEW_KEY ? undefined : key;
}

export function workbenchScope(key: WorkbenchViewKey): WorkbenchScope {
  return key === WORKBENCH_HOME_VIEW_KEY ? { kind: "pathless" } : { kind: "project" };
}

function normalized(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/u, "");
}

export function workspaceFile(
  path: string,
  views: Iterable<WorkbenchViewKey>,
): { readonly view: WorkbenchViewKey; readonly relative: string } | undefined {
  const file = normalized(path);

  const roots = [...views].flatMap((view) => {
    const root = workspacePathForView(view);

    return root === undefined ? [] : [{ view, root: `${normalized(root)}/` }];
  });

  const owner = roots
    .filter((candidate) => file.startsWith(candidate.root))
    .toSorted((left, right) => right.root.length - left.root.length)[0];

  return owner === undefined
    ? undefined
    : { view: owner.view, relative: file.slice(owner.root.length) };
}
