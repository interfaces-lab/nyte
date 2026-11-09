import type { ForgetOutcome, WorkspaceInfo, WorkspaceId } from "@nyte-ai/sdk";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { toast } from "@nyte-ai/ui/toast";
import { keys, queryClient } from "./query-client.ts";
import type { HostState, SelectedWorkspace } from "../contract/bridge.ts";
import { connected } from "./connection.ts";
import { groupByWorkspace } from "./session-list.ts";
import { useRootRows } from "./session-rows.ts";
import { useWatchSelect } from "./watch-store.ts";
import { hostWatch } from "./watches.ts";

export const workspacesQuery = {
  queryKey: keys.workspaces,
  queryFn: async () => (await connected()).workspaces.list(),
};

export function selectedWorkspaceId(): WorkspaceId | undefined {
  return queryClient.getQueryData<HostState>(keys.host)?.workspace?.id;
}

export function useHomeWorkspace(): WorkspaceId | null | undefined {
  const live = useWatchSelect(hostWatch("host"), (state) => state.value?.defaultWorkspace);

  return live === undefined
    ? queryClient.getQueryData<WorkspaceId | null>(keys.firstFrameHome)
    : live;
}

export interface RailWorkspace extends SelectedWorkspace {
  readonly available: boolean;
  readonly worktree: { readonly source: WorkspaceId; readonly branch: string } | null;
}

export function useWorkspaces() {
  const pending = useMutationState<MutationState<ForgetOutcome, Error, WorkspaceId>>({
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

export interface RecentWorkspace extends RailWorkspace {
  readonly hint: string | undefined;
}

export function useRecentWorkspaces(
  options: { readonly exclude?: string } = {},
): readonly RecentWorkspace[] {
  const workspaces = useWorkspaces().data ?? [];
  const roots = useRootRows();
  const lastActivity = new Map<string, number>();

  for (const group of groupByWorkspace(roots ?? [], workspaces)) {
    const path = group.workspacePath;

    if (path === null) continue;

    for (const session of group.sessions)
      lastActivity.set(path, Math.max(session.lastActivityAt, lastActivity.get(path) ?? 0));
  }

  const folders = [
    ...new Map(
      workspaces
        .filter(
          (candidate) =>
            candidate.available &&
            candidate.worktree === null &&
            candidate.path !== options.exclude,
        )
        .map((candidate) => [candidate.path, candidate]),
    ).values(),
  ].toSorted(
    (left, right) => (lastActivity.get(right.path) ?? 0) - (lastActivity.get(left.path) ?? 0),
  );

  const nameCounts = new Map<string, number>();

  for (const folder of folders) nameCounts.set(folder.name, (nameCounts.get(folder.name) ?? 0) + 1);

  return folders.map((folder) => ({
    ...folder,
    hint:
      (nameCounts.get(folder.name) ?? 0) > 1
        ? folder.path.split(/[\\/]/u).filter(Boolean).at(-2)
        : undefined,
  }));
}

export function useForgetWorkspace() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: ["workspace", "forget"],
    mutationFn: async (id: WorkspaceId) => (await connected()).workspaces.forget(id),
    onSuccess: async (outcome, id) => {
      if (outcome.kind === "busy") return;
      await client.cancelQueries({ queryKey: keys.workspaces, exact: true });
      client.setQueryData<readonly WorkspaceInfo[]>(keys.workspaces, (workspaces) =>
        workspaces?.filter((workspace) => workspace.id !== id),
      );
      toast.add({
        type: "success",
        title: "Folder and its chats removed",
        id: "workspace-forgotten",
      });
    },
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
