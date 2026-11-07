import type { ReactElement } from "react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@nyte-ai/ui/context-menu";
import { revealLabel } from "../../components/context-menu.ts";
import { nyte } from "../../contract/nyte.ts";
import { addFileToChat } from "../../references/add-to-chat.ts";
import type { EditorTarget, WorkbenchViewKey } from "../model.ts";
import { fileActions, useFileTabs } from "./file-store.ts";
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
  const files = useFileTabs(viewKey);
  const group = files.groups.find((entry) => entry.id === file.group);
  const position = group?.tabs.findIndex((tab) => tab.id === file.id) ?? -1;
  const left = document.dir === "rtl" ? 1 : -1;
  const right = -left;

  const move = (target: EditorTarget): void => {
    fileActions.place(viewKey, { kind: "tab", id: file.id }, target);
    requestAnimationFrame(() => {
      const selected = document
        .getElementById(`${viewKey}-file-tabs-${target.group}`)
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');

      selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
      selected?.focus();
    });
  };

  const moveOne = (step: number): void =>
    move({
      kind: "tabs",
      group: file.group,
      before:
        step < 0
          ? (group?.tabs[position - 1]?.id ?? null)
          : (group?.tabs[position + 2]?.id ?? null),
    });

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
      <ContextMenuItem
        disabled={group?.tabs[position + left] === undefined}
        onClick={() => moveOne(left)}
      >
        Move Left
      </ContextMenuItem>
      <ContextMenuItem
        disabled={group?.tabs[position + right] === undefined}
        onClick={() => moveOne(right)}
      >
        Move Right
      </ContextMenuItem>
      {files.groups.length > 1 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to Group</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {files.groups.map((destination, index) => (
              <ContextMenuItem
                key={destination.id}
                disabled={destination.id === file.group}
                onClick={() => move({ kind: "tabs", group: destination.id, before: null })}
              >
                {`Group ${String(index + 1)}`}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
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
