import type { ContextMenuItem, ContextMenuOpenContext } from "@nyte-ai/ui/trees";
import type { HostBridge } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { revealLabel, showContextMenu } from "../components/context-menu.ts";
import { addFileToChat } from "../references/add-to-chat.ts";
import { absolute, refresh } from "./explorer-operations.ts";
import type { Explorer } from "./explorer-operations.ts";
import { fileActions } from "./file-store.ts";

/** Opens the native menu for an explorer row, under the row. */
export function openRowMenu(
  menu: NonNullable<HostBridge["contextMenu"]>,
  item: ContextMenuItem,
  context: ContextMenuOpenContext,
  {
    explorer,
    revealPath,
    startNaming,
    duplicate,
    remove,
    onSearch,
    onCopyPath,
  }: {
    readonly explorer: Explorer;
    readonly revealPath: HostBridge["revealPath"];
    readonly startNaming: (kind: "file" | "folder", folder: string) => void;
    readonly duplicate: (item: ContextMenuItem) => void;
    readonly remove: (item: ContextMenuItem) => void;
    readonly onSearch: () => void;
    readonly onCopyPath: (path: string) => void;
  },
): void {
  context.close({ restoreFocus: false });
  const file = explorer.latest.current.files?.find((entry) => entry.displayPath === item.path);
  const relative = item.path.replace(/\/$/u, "");
  const absolutePath = file?.path ?? absolute(explorer, relative);

  const folder =
    item.kind === "directory" ? item.path : item.path.slice(0, item.path.lastIndexOf("/") + 1);

  void showContextMenu(
    menu,
    { clientX: context.anchorRect.left, clientY: context.anchorRect.bottom },
    [
      file !== undefined &&
        item.kind === "file" && {
          kind: "item",
          label: "Open File",
          run: () => fileActions.open(explorer.viewKey, file),
        },
      file !== undefined &&
        item.kind === "file" && {
          kind: "item",
          label: "Add File to Chat",
          run: () => addFileToChat(file),
        },
      { kind: "item", label: "New File\u2026", run: () => startNaming("file", folder) },
      { kind: "item", label: "New Folder\u2026", run: () => startNaming("folder", folder) },
      { kind: "separator" },
      absolutePath !== undefined &&
        revealPath !== undefined && {
          kind: "item",
          label: revealLabel(nyte.platform),
          run: () => void revealPath({ path: absolutePath }),
        },
      { kind: "item", label: "Search Files", run: onSearch },
      { kind: "separator" },
      absolutePath !== undefined && {
        kind: "item",
        label: "Copy Path",
        run: () => onCopyPath(absolutePath),
      },
      { kind: "item", label: "Copy Relative Path", run: () => onCopyPath(relative) },
      { kind: "separator" },
      { kind: "item", label: "Rename\u2026", run: () => explorer.model.startRenaming(item.path) },
      { kind: "item", label: "Duplicate", run: () => duplicate(item) },
      { kind: "item", label: "Delete", run: () => remove(item) },
      { kind: "separator" },
      { kind: "item", label: "Refresh Explorer", run: () => refresh(explorer) },
    ],
  );
}
