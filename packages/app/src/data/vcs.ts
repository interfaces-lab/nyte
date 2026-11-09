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
import { queryClient } from "./query-client.ts";

export async function gitFor(workspace: WorkspaceId | undefined): Promise<GitApi> {
  if (workspace === undefined) throw new Error("Open a workspace to read its repository");
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
  workspace: WorkspaceId | undefined,
  scope: GitScope | undefined,
  ignoreWhitespace: boolean,
  revision: string | undefined,
  enabled: boolean,
) {
  return useQuery<ChangeSet>({
    queryKey: keys.gitChanges(workspace, scope, ignoreWhitespace, revision),
    queryFn: async () => {
      if (scope === undefined) throw new Error("Choose what to compare");

      return (await gitFor(workspace)).changes(scope, { ignoreWhitespace });
    },
    enabled: enabled && scope !== undefined && workspace !== undefined,
    placeholderData: (previous) => previous,
  });
}

export function useVcsLog(
  workspace: WorkspaceId | undefined,
  input: { readonly limit: number; readonly cursor?: Cursor | undefined },
  enabled: boolean,
) {
  const status = useWatch(
    enabled && workspace !== undefined ? gitStatusWatch(workspace) : undefined,
  ).value;

  const head = status?.kind === "repository" ? status.head : undefined;

  return useQuery({
    queryKey: keys.gitLog(workspace, head, input.limit, input.cursor),
    queryFn: async () =>
      (await gitFor(workspace)).log({
        head: head ?? undefined,
        cursor: input.cursor,
        limit: input.limit,
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
  workspace: WorkspaceId | undefined,
  scope: GitScope,
  paths: readonly string[],
  ignoreWhitespace: boolean,
): Promise<readonly PatchEntry[]> {
  return firstPatches((await gitFor(workspace)).patches(scope, paths, { ignoreWhitespace }), paths);
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

export async function refreshVcs(workspace: WorkspaceId | undefined): Promise<void> {
  if (workspace !== undefined) gitStatusWatch(workspace).retry();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["git"] }),
    queryClient.invalidateQueries({ queryKey: keys.mentionFiles(workspace), exact: true }),
    queryClient.invalidateQueries({ queryKey: keys.documents }),
  ]);
}

export function useVcsSnapshot(workspace: WorkspaceId | undefined, enabled: boolean) {
  return {
    data: useWatch(workspace === undefined ? undefined : gitStatusWatch(workspace), enabled).value,
  };
}
