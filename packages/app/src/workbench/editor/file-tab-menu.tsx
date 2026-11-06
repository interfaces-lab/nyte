import type { ReactElement } from "react";
import { ContextMenuItem, ContextMenuSeparator } from "@nyte-ai/ui/context-menu";
import { revealLabel } from "../../components/context-menu.ts";
import { nyte } from "../../contract/nyte.ts";
import { addFileToChat } from "../../references/add-to-chat.ts";
import type { WorkbenchViewKey } from "../model.ts";
import { fileActions } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";

export function FileTabMenuItems({
  viewKey,
  file,
  onClose,
  onCloseOthers,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly file: FileTab;
  readonly onClose: () => void;
  readonly onCloseOthers: () => void;
}): ReactElement {
  const revealPath = nyte.host.revealPath;

  return (
    <>
      <ContextMenuItem icon="x" onClick={onClose}>
        Close
      </ContextMenuItem>
      <ContextMenuItem onClick={onCloseOthers}>Close Others</ContextMenuItem>
      {file.preview && (
        <ContextMenuItem icon="pin" onClick={() => fileActions.pin(viewKey, file.id)}>
          Keep Open
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon="split-right"
        onClick={() => fileActions.split(viewKey, "after", file.id)}
      >
        Split Right
      </ContextMenuItem>
      <ContextMenuItem onClick={() => fileActions.split(viewKey, "before", file.id)}>
        Split Left
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon="paperclip" onClick={() => addFileToChat(file)}>
        Add File to Chat
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon="copy" onClick={() => void navigator.clipboard.writeText(file.path)}>
        Copy Path
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void navigator.clipboard.writeText(file.displayPath)}>
        Copy Relative Path
      </ContextMenuItem>
      {revealPath !== undefined && (
        <ContextMenuItem onClick={() => void revealPath({ path: file.path })}>
          {revealLabel(nyte.platform)}
        </ContextMenuItem>
      )}
    </>
  );
}
