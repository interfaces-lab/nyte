import type { WorkspaceInfo, WorkspaceId } from "@nyte-ai/sdk";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { toast } from "@nyte-ai/ui/toast";
import { keys, queryClient } from "./query-client.ts";
import type { HostState, SelectedWorkspace } from "../contract/bridge.ts";
import { connected } from "./connection.ts";

export const workspacesQuery = {
  queryKey: keys.workspaces,
  queryFn: async () => (await connected()).workspaces.list(),
};

export function selectedWorkspaceId(): WorkspaceId | undefined {
  return queryClient.getQueryData<HostState>(keys.host)?.workspace?.id;
}

export interface RailWorkspace extends SelectedWorkspace {
  readonly available: boolean;
  readonly worktree: { readonly source: WorkspaceId; readonly branch: string } | null;
}

export function useWorkspaces() {
  const pending = useMutationState<MutationState<void, Error, WorkspaceId>>({
    filters: { mutationKey: ["workspace", "forget"], status: "pending" },
  });

  return useQuery({
    ...workspacesQuery,
    placeholderData: () =>
      queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.firstFrameWorkspaces),
    select: (workspaces): readonly RailWorkspace[] =>
      workspaces.flatMap((workspace) => {
        const path = workspacePath(workspace);

        return path === null || pending.some((mutation) => mutation.variables === workspace.id)
          ? []
          : [
              {
                id: workspace.id,
                path,
                name: workspaceName(workspace),
                available: workspace.availability.kind === "available",
                worktree:
                  workspace.isolation === null
                    ? null
                    : { source: workspace.isolation.source, branch: workspace.isolation.branch },
              },
            ];
      }),
  });
}

export function useForgetWorkspace() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ["workspace", "forget"],
    mutationFn: async (id: WorkspaceId) => {
      const outcome = await (await connected()).workspaces.forget(id);

      if (outcome.kind === "busy") throw new Error("Chats still use this workspace");
    },
    onSuccess: async (_result, id) => {
      await client.cancelQueries({ queryKey: keys.workspaces, exact: true });
      client.setQueryData<readonly WorkspaceInfo[]>(keys.workspaces, (workspaces) =>
        workspaces?.filter((workspace) => workspace.id !== id),
      );
      toast.add({
        type: "success",
        title: "Workspace removed from sidebar",
        id: "workspace-forgotten",
      });
    },
    onError: () =>
      toast.add({
        type: "error",
        title: "Couldn't remove this workspace. Try again.",
        id: "workspace-forget-error",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function commitHostWorkspace(workspace: SelectedWorkspace | undefined): void {
  queryClient.setQueryData<HostState>(keys.host, (host) => ({ ...host, workspace }));
}

export function workspacePath(workspace: Pick<WorkspaceInfo, "target">): string | null {
  const { target } = workspace;

  return target.kind === "local" && "path" in target ? target.path : null;
}

export function workspaceName(workspace: Pick<WorkspaceInfo, "target">): string {
  const path = workspacePath(workspace);

  return path === null
    ? workspace.target.kind
    : (path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path);
}
