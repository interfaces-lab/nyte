import type { ReactElement, ReactNode } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { ReferenceScope } from "../editor/reference-scope.tsx";
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
    <ReferenceScope folder={folder}>
      <AgentCitationContext value={citeSubagent}>{children}</AgentCitationContext>
    </ReferenceScope>
  );
}
