import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { useRef } from "react";
import type { ReactElement, RefObject } from "react";
import { EDITOR_SLOT } from "../workbench/model.ts";
import type { EditorGroupId, WorkbenchTabId, WorkbenchViewKey } from "../workbench/model.ts";
import { fileActions } from "./file-store.ts";
import type { FileGroup, FileTab } from "./file-store.ts";

/** Closes files and groups, and asks before a close drops unsaved changes. */
export interface FileClosing {
  readonly panelRef: RefObject<HTMLElement | null>;
  readonly closeFile: (id: WorkbenchTabId) => void;
  readonly closeGroup: (group: EditorGroupId) => void;
  readonly confirmation: ReactElement;
}

/** Closes a file or a group and returns focus to the tab that asked, or the nearest one left. Its confirmation asks before a close drops unsaved changes. */
export function useFileClosing({
  viewKey,
  groups,
  pendingFile,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly groups: readonly FileGroup[];
  readonly pendingFile: FileTab | undefined;
}): FileClosing {
  const panelRef = useRef<HTMLElement>(null);
  const closeOrigin = useRef<WorkbenchTabId | undefined>(undefined);

  const restoreFileFocus = (): HTMLElement | null =>
    (closeOrigin.current === undefined
      ? null
      : document.getElementById(`${viewKey}-file-tab-${closeOrigin.current}`)) ??
    panelRef.current?.querySelector<HTMLElement>(
      '[data-editor-tabs][data-focused] [role="tab"][aria-selected="true"]',
    ) ??
    document.getElementById(`${viewKey}-tab-${EDITOR_SLOT}`) ??
    document.getElementById("workbench-toggle");

  const closeFile = (id: WorkbenchTabId): void => {
    closeOrigin.current = id;

    if (!fileActions.close(viewKey, id)) return;
    closeOrigin.current = undefined;
    requestAnimationFrame(() => restoreFileFocus()?.focus());
  };

  const closeGroup = (group: EditorGroupId): void => {
    closeOrigin.current = groups.find((entry) => entry.id === group)?.active?.id;

    if (!fileActions.closeGroup(viewKey, group)) return;
    closeOrigin.current = undefined;
    requestAnimationFrame(() => restoreFileFocus()?.focus());
  };

  const confirmation = (
    <ConfirmDialog
      open={pendingFile !== undefined}
      pending={pendingFile?.saving === true}
      pendingLabel="Saving…"
      finalFocus={restoreFileFocus}
      title="Discard Changes"
      description={
        <span aria-live="polite">{`Your changes to ${pendingFile?.displayPath ?? "this file"} will be lost.`}</span>
      }
      confirmLabel="Discard Changes"
      onOpenChange={(open) => {
        if (open) return;
        closeOrigin.current = pendingFile?.id;
        fileActions.cancelClose(viewKey);
      }}
      onConfirm={() => {
        closeOrigin.current = undefined;
        fileActions.discardClose(viewKey);
      }}
    />
  );

  return { panelRef, closeFile, closeGroup, confirmation };
}
