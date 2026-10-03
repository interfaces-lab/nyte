import { isFolder } from "../conversation/message-references.ts";
import type { ReferenceOpener } from "../conversation/reference-opener.tsx";
import type { WorkbenchViewKey } from "./controller.ts";
import { workbenchController } from "./controller.ts";
import { fileActions } from "./file-store.ts";

/**
 * Opens what a composer chip or link stands for in this view's workbench:
 * files as preview tabs, folders as explorer selections, links as browser
 * tabs. The editor reads only inside the workspace, so anything else is not
 * openable.
 */
export function workbenchReferenceOpener(input: {
  readonly viewKey: WorkbenchViewKey;
  readonly workspacePath: string | undefined;
}): ReferenceOpener {
  const { viewKey, workspacePath } = input;

  return (reference) => {
    if (reference.kind === "url") {
      return () =>
        workbenchController.actions.openTab({
          view: viewKey,
          tab: { kind: "browser", url: reference.url },
          activate: true,
        });
    }

    if (workspacePath === undefined) return undefined;

    switch (reference.kind) {
      case "file": {
        const { file } = reference;

        if (isFolder(file)) return () => fileActions.reveal(viewKey, file.displayPath);

        return () =>
          fileActions.open(viewKey, {
            path: file.path,
            line: reference.lines?.start,
            preview: true,
          });
      }

      case "skill": {
        const root = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;

        if (!reference.path.startsWith(root)) return undefined;

        return () => fileActions.open(viewKey, { path: reference.path, preview: true });
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
