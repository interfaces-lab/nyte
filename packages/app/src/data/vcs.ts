import { useQuery } from "@tanstack/react-query";
import type {
  ChangeSet,
  ChangeSource,
  Cursor,
  GitApi,
  GitScope,
  PatchEntry,
  PatchSet,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { keys } from "./query-client.ts";
import { gitStatusWatch } from "./watches.ts";
import { connected } from "./connection.ts";
import { useWatch } from "./watch-store.ts";
import { selectedWorkspaceId } from "./workspaces.ts";
import { useHostState } from "./host.ts";
import { queryClient } from "./query-client.ts";

export async function workspaceGit(): Promise<GitApi> {
  const id = selectedWorkspaceId();

  if (id === undefined) throw new Error("Open a workspace to read its repository");

  return gitFor(id);
}

export async function gitFor(workspace: WorkspaceId): Promise<GitApi> {
  const capability = await (await connected()).workspace(workspace).git();

  if (capability.kind !== "available") throw new Error(capability.reason);

  return capability.api;
}

export function useGitRefs(workspace: WorkspaceId, enabled: boolean) {
  return useQuery({
    queryKey: keys.gitRefs(workspace),
    queryFn: async () => (await gitFor(workspace)).refs(),
    enabled,
    staleTime: 0,
  });
}

export function useVcsChanges(
  scope: GitScope | undefined,
  ignoreWhitespace: boolean,
  revision: string | undefined,
  enabled: boolean,
) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

  return useQuery<ChangeSet>({
    queryKey: keys.gitChanges(workspace, scope, ignoreWhitespace, revision),
    queryFn: async () => {
      if (scope === undefined) throw new Error("Choose what to compare");

      return (await workspaceGit()).changes(scope, { ignoreWhitespace });
    },
    enabled: enabled && scope !== undefined && workspace !== undefined,
    placeholderData: (previous) => previous,
  });
}

/** Keyed by HEAD so a checkout, commit or reset anywhere reads it anew. */
export function useVcsLog(
  input: { readonly limit: number; readonly cursor?: Cursor | undefined },
  enabled: boolean,
) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

  const status = useWatch(
    enabled && workspace !== undefined ? gitStatusWatch(workspace) : undefined,
  ).value;

  const head = status?.kind === "repository" ? status.head : undefined;

  return useQuery({
    queryKey: keys.gitLog(workspace, head, input.limit, input.cursor),
    queryFn: async () =>
      (await workspaceGit()).log({
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      }),
    enabled: enabled && workspace !== undefined && head !== undefined,
  });
}

export function useRecordedChanges(input: {
  readonly workspace: WorkspaceId | undefined;
  readonly source: ChangeSource | undefined;
  readonly live: boolean;
  readonly enabled?: boolean;
}) {
  const { workspace, source, live, enabled = true } = input;

  return useQuery<ChangeSet>({
    queryKey: keys.recordedChanges(workspace, source, live),
    queryFn: async () => {
      if (workspace === undefined || source === undefined) throw new Error("Nothing to compare");

      return (await connected()).workspace(workspace).changes(source);
    },
    enabled: enabled && workspace !== undefined && source !== undefined,
    staleTime: live ? 0 : "static",
  });
}

async function firstPatches(
  stream: AsyncIterable<PatchSet>,
  paths: readonly string[],
): Promise<readonly PatchEntry[]> {
  for await (const set of stream) {
    const entries = paths.flatMap((path) => {
      const entry = set.entries.get(path);

      return entry === undefined || !entry.fresh ? [] : [entry];
    });

    if (entries.length === paths.length) return entries;
  }

  return [];
}

export async function readGitPatches(
  scope: GitScope,
  paths: readonly string[],
  ignoreWhitespace: boolean,
): Promise<readonly PatchEntry[]> {
  return firstPatches((await workspaceGit()).patches(scope, paths, { ignoreWhitespace }), paths);
}

export async function readRecordedPatches(
  workspace: WorkspaceId,
  source: ChangeSource,
  paths: readonly string[],
  ignoreWhitespace: boolean,
): Promise<readonly PatchEntry[]> {
  const current = await connected();

  return firstPatches(
    current.workspace(workspace).patches(source, paths, { ignoreWhitespace }),
    paths,
  );
}

export async function refreshVcs(): Promise<void> {
  const workspace = selectedWorkspaceId();

  if (workspace !== undefined) gitStatusWatch(workspace).retry();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["git"] }),
    queryClient.invalidateQueries({ queryKey: keys.mentionFiles, exact: true }),
    queryClient.invalidateQueries({ queryKey: ["files", "document"] }),
  ]);
}

export function useVcsSnapshot(enabled: boolean) {
  const host = useHostState();
  const workspace = host.data.workspace?.id;

  return {
    data: useWatch(enabled && workspace !== undefined ? gitStatusWatch(workspace) : undefined)
      .value,
  };
}
