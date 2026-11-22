import type { ReactElement, ReactNode } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { ReferenceOpenerContext } from "../references/reference-opener.tsx";
import { workbenchReferenceOpener } from "../workbench/commands.ts";
import { useWorkbenchViewKey } from "../workbench/paths.ts";
import { ChatFolderContext } from "../chats/index.ts";
import { AgentCitationContext } from "../markdown/prose.tsx";
import { citeSubagent } from "./tools/subagent-call.tsx";

export function ChatScope({
  folder,
  children,
}: {
  readonly folder: SelectedWorkspace | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <ChatFolderContext value={folder}>
      <ReferenceOpenerContext value={workbenchReferenceOpener(useWorkbenchViewKey(folder?.path))}>
        <AgentCitationContext value={citeSubagent}>{children}</AgentCitationContext>
      </ReferenceOpenerContext>
    </ChatFolderContext>
  );
}
