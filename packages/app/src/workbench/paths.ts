import type { WorkbenchScope, WorkbenchViewKey } from "./model.ts";

/** The view of the window with no workspace open; every other view is keyed by its workspace's path. */
export const WORKBENCH_HOME_VIEW_KEY: WorkbenchViewKey = "home";

export function workbenchViewKey(workspacePath: string | undefined): WorkbenchViewKey {
  return workspacePath ?? WORKBENCH_HOME_VIEW_KEY;
}

export function workspacePathForView(key: WorkbenchViewKey): string | undefined {
  return key === WORKBENCH_HOME_VIEW_KEY ? undefined : key;
}

export function workbenchScope(workspacePath: string | undefined): WorkbenchScope {
  return workspacePath === undefined ? { kind: "pathless" } : { kind: "project" };
}

function normalized(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/u, "");
}

/**
 * The view whose workspace holds `path`, and the path inside it; the deepest workspace wins.
 * `undefined` for a file outside every workspace, which opens read-only.
 */
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
