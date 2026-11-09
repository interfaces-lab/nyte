import { createContext, use } from "react";
import type { Context } from "react";
import type { WorkspaceId } from "@nyte-ai/sdk";
import type { SelectedWorkspace } from "../contract/bridge.ts";

export type WorkbenchWorkspace =
  | { readonly kind: "none" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly workspace: SelectedWorkspace;
      readonly isChatFolder: boolean;
    }
  | { readonly kind: "unavailable"; readonly id: WorkspaceId };

export const WorkbenchWorkspaceContext: Context<WorkbenchWorkspace> =
  createContext<WorkbenchWorkspace>({ kind: "none" });

export function useWorkbenchWorkspace(): WorkbenchWorkspace {
  return use(WorkbenchWorkspaceContext);
}
