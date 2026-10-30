import type { ReactElement, ReactNode } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { ReferenceOpenerContext } from "../references/reference-opener.tsx";
import { workbenchReferenceOpener } from "../workbench/commands.ts";
import { workbenchViewKey } from "../workbench/paths.ts";
import { ChatFolderContext } from "./chat-folder.ts";

/** Gives a conversation its folder and opens what it links in that folder's workbench, so a split or a hidden chat never reads another chat's folder. */
export function ChatScope({
  folder,
  children,
}: {
  readonly folder: SelectedWorkspace | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <ChatFolderContext value={folder}>
      <ReferenceOpenerContext value={workbenchReferenceOpener(workbenchViewKey(folder?.path))}>
        {children}
      </ReferenceOpenerContext>
    </ChatFolderContext>
  );
}
