import { useEffect, useRef } from "react";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { fileActions } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";

/** Records the active file in the view's recent list each time it becomes active while the panel shows. */
export function useRememberActiveFile({
  viewKey,
  activeFile,
  tabs,
  shown,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly activeFile: FileTab | undefined;
  readonly tabs: readonly FileTab[];
  readonly shown: boolean;
}): void {
  const visitedFile = useRef<
    | {
        readonly viewKey: WorkbenchViewKey;
        readonly file: typeof activeFile;
      }
    | undefined
  >(undefined);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- records activation from tab clicks and group focus in the file store
  useEffect(() => {
    if (!shown) return;
    const previous = visitedFile.current;
    visitedFile.current = { viewKey, file: activeFile };

    if (activeFile === undefined) return;

    if (previous?.viewKey === viewKey) {
      if (previous.file?.id === activeFile.id && previous.file.path === activeFile.path) return;

      if (previous.file !== undefined && !tabs.some((file) => file.id === previous.file?.id)) {
        return;
      }
    }

    fileActions.remember(viewKey, activeFile.path);
  }, [shown, activeFile, tabs, viewKey]);
}
