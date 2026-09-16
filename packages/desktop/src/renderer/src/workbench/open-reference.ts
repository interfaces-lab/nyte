import { isFolder } from "../conversation/message-references.ts";
import type { ReferenceOpener } from "../conversation/reference-opener.tsx";
import type { WorkbenchViewKey } from "./controller.ts";
import { fileActions } from "./file-store.ts";

function workspaceRelativePath(workspacePath: string, path: string): string | undefined {
  const root = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;
  return path.startsWith(root) ? path.slice(root.length) : undefined;
}

/**
 * Opens what a composer chip stands for in this view's workbench: files as
 * preview tabs, folders as explorer selections. The editor reads only inside
 * the workspace, so anything else is not openable.
 */
export function workbenchReferenceOpener(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly workspacePath: string | undefined;
}): ReferenceOpener {
  const { viewKey, workspacePath } = input;
  return (reference) => {
    if (workspacePath === undefined) return undefined;
    switch (reference.kind) {
      case "file": {
        const { file } = reference;
        if (isFolder(file)) return () => fileActions.reveal(viewKey, file.displayPath);
        return () =>
          fileActions.open(viewKey, {
            path: file.path,
            displayPath: file.displayPath,
            preview: true,
          });
      }
      case "skill": {
        const displayPath =
          reference.path === "" ? undefined : workspaceRelativePath(workspacePath, reference.path);
        if (displayPath === undefined) return undefined;
        return () =>
          fileActions.open(viewKey, { path: reference.path, displayPath, preview: true });
      }
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
