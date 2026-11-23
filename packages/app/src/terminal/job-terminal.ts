import type { JobView, WorkspaceId } from "@nyte-ai/sdk";
import { matchingTab } from "../workbench/model.ts";
import type { WorkbenchTabId, WorkbenchViewKey } from "../workbench/model.ts";
import { workbench } from "../workbench/store.ts";
import { terminalActions } from "./terminal-store.ts";

export function openJobTerminal(
  view: WorkbenchViewKey,
  workspace: WorkspaceId,
  job: JobView,
): WorkbenchTabId {
  const input = { kind: "terminal", owner: { kind: "job", workspace, job: job.id } } as const;
  const id = matchingTab(workbench.getView(view).tabs, input)?.id ?? crypto.randomUUID();
  workbench.dispatch(view, { kind: "open", tab: { id, ...input }, activate: true });
  terminalActions.openJob({ id, workspace, job });

  return id;
}
