import { hashKey, QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { ChangeSource, GitCommitId, GitScope, SessionId, WorkspaceId } from "@nyte-ai/sdk";

export const keys = {
  host: ["host"] as const,
  clientOperations: ["client-operations"] as const,
  updates: ["updates"] as const,
  updateChannel: ["updates", "channel"] as const,
  hostProcess: ["host-process"] as const,
  bundledCli: ["bundled-cli"] as const,
  workspaces: ["workspaces"] as const,
  workspaceCatalog: (workspace: WorkspaceId | undefined) =>
    ["workspaces", "catalog", workspace] as const,
  workspaceInfo: (workspace: WorkspaceId | undefined) => ["workspaces", "info", workspace] as const,
  firstFrameWorkspaces: ["first-frame", "workspaces"] as const,
  firstFrameRoots: ["first-frame", "roots"] as const,
  firstFrameHome: ["first-frame", "home"] as const,
  modelCatalog: (generation: string) => ["catalog", "models", generation] as const,
  accountLimits: (generation: string) => ["account-limits", generation] as const,
  modelAccounts: (provider: string, generation: string) =>
    ["model-accounts", provider, generation] as const,
  usage: (sinceDay: string | null, untilDay: string) => ["usage", sinceDay, untilDay] as const,
  githubAccount: ["github-account"] as const,
  github: ["github"] as const,
  githubCapability: (workspace: WorkspaceId | undefined) =>
    ["github", "capability", workspace] as const,
  githubState: (workspace: WorkspaceId | undefined) => ["github", "state", workspace] as const,
  githubRepository: (workspace: WorkspaceId | undefined) =>
    ["github", "repository", workspace] as const,
  server: ["server"] as const,
  remoteAccess: ["remote-access"] as const,
  connect: ["remote-access", "connect"] as const,
  session: (sessionId: SessionId) => ["session", sessionId] as const,
  gitChanges: (
    workspace: WorkspaceId | undefined,
    scope: GitScope | undefined,
    ignoreWhitespace: boolean,
    revision: string | undefined,
  ) => ["git", "changes", workspace, scope, ignoreWhitespace, revision] as const,
  gitLog: (
    workspace: WorkspaceId | undefined,
    head: GitCommitId | null | undefined,
    limit: number,
    cursor: string | undefined,
  ) => ["git", "log", workspace, head, limit, cursor] as const,
  gitRefs: (workspace: WorkspaceId) => ["git", "refs", workspace] as const,
  recordedChanges: (
    workspace: WorkspaceId | undefined,
    source: ChangeSource | undefined,
    live: boolean,
  ) => ["git", "recorded", workspace, source, live ? "live" : "settled"] as const,
  mentionFiles: (workspace: WorkspaceId | undefined) => ["files", "mentions", workspace] as const,
  workspaceSearch: (workspace: string, input: { readonly query: string } | undefined) =>
    ["files", "search", workspace, input] as const,
  document: (path: string | undefined) => ["documents", path] as const,
  browserHistory: (owner: string | null) => ["browser", "history", owner] as const,
  mermaid: (source: string) => ["mermaid", source] as const,
};

/**
 * The first key segment of every read the host answers, here once rather than at each query: a
 * host read heals when the link opens again (`linkReopened`) and is dropped when a connection to
 * another host replaces this one. The rest are the window's, the desktop's, or caches seeded at
 * startup.
 */
const HOST_READS: ReadonlySet<unknown> = new Set([
  "workspaces",
  "catalog",
  "account-limits",
  "model-accounts",
  "github",
  "github-account",
  "session",
  "git",
  "files",
  "documents",
  "blob",
  "canvas-revision",
  "part-view",
  "command-completion",
]);

export function readsHost(query: { readonly queryKey: QueryKey }): boolean {
  return HOST_READS.has(query.queryKey[0]);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      staleTime: Infinity,
      retry: false,
    },
  },
});

/**
 * For store sources, which read on every snapshot: `getQueryData` merges the defaults and hashes
 * the key on each call, so the reader hashes it once.
 */
export function queryDataReader<T>(queryKey: QueryKey): () => T | undefined {
  const queryHash = hashKey(queryKey);

  return () => queryClient.getQueryCache().get<T>(queryHash)?.state.data;
}
