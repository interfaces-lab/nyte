import type { ReactElement, ReactNode } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { ChatFolderContext } from "../chats/index.ts";
import { ReferenceOpenerContext } from "../references/reference-opener.tsx";
import { useWorkbenchViewKey } from "../workbench/paths.ts";
import { workbenchReferenceOpener } from "./reference-opener.ts";

/** Gives prose under it a folder to resolve paths against and opens its references in that folder's workbench. */
export function ReferenceScope({
  folder,
  children,
}: {
  readonly folder: SelectedWorkspace | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <ChatFolderContext value={folder}>
      <ReferenceOpenerContext value={workbenchReferenceOpener(useWorkbenchViewKey(folder?.path))}>
        {children}
      </ReferenceOpenerContext>
    </ChatFolderContext>
  );
}
