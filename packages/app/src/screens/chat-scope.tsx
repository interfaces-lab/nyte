import type { ReactElement, ReactNode } from "react";
import type { SelectedWorkspace } from "../bridge.ts";
import { ChatFolderContext } from "../conversation/chat-folder.ts";
import { ReferenceOpenerContext } from "../conversation/reference-opener.tsx";
import { workbenchViewKey } from "../workbench/controller.ts";
import { workbenchReferenceOpener } from "../workbench/open-reference.ts";

/** Gives a conversation its folder and opens what it links in that folder's workbench, so a split or a hidden chat never reads another chat's folder. */
export function ChatScope({
  folder,
  children,
}: {
  readonly folder: SelectedWorkspace | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const workspacePath = folder?.path;

  return (
    <ChatFolderContext value={folder}>
      <ReferenceOpenerContext
        value={workbenchReferenceOpener({
          viewKey: workbenchViewKey(workspacePath),
          workspacePath,
        })}
      >
        {children}
      </ReferenceOpenerContext>
    </ChatFolderContext>
  );
}
