import type { ChangeSource, GitScope, SessionId, WorkspaceId } from "@nyte-ai/sdk";

export const keys = {
  host: ["host"] as const,
  clientOperations: ["client-operations"] as const,
  hostSettings: ["host-settings"] as const,
  updates: ["updates"] as const,
  workspaces: ["workspaces"] as const,
  workspaceCatalog: (workspace: WorkspaceId | undefined) =>
    ["workspaces", "catalog", workspace] as const,
  firstFrameWorkspaces: ["first-frame", "workspaces"] as const,
  firstFrameRoots: ["first-frame", "roots"] as const,
  modelCatalog: (generation: string) => ["catalog", "models", generation] as const,
  accountLimits: (generation: string) => ["account-limits", generation] as const,
  usage: (sinceDay: string | null, untilDay: string) => ["usage", sinceDay, untilDay] as const,
  github: ["github"] as const,
  server: ["server"] as const,
  remoteAccess: ["remote-access"] as const,
  connect: ["remote-access", "connect"] as const,
  session: (sessionId: SessionId) => ["session", sessionId] as const,
  sessionConfiguration: (sessionId: SessionId, lastActivityAt: number) =>
    ["session", sessionId, "configuration", lastActivityAt] as const,
  gitChanges: (
    workspace: WorkspaceId | undefined,
    scope: GitScope | undefined,
    ignoreWhitespace: boolean,
    revision: string | undefined,
  ) => ["git", "changes", workspace, scope, ignoreWhitespace, revision] as const,
  gitLog: (workspace: WorkspaceId | undefined, limit: number, cursor: string | undefined) =>
    ["git", "log", workspace, limit, cursor] as const,
  recordedChanges: (
    workspace: WorkspaceId | undefined,
    source: ChangeSource | undefined,
    live: boolean,
  ) => ["git", "recorded", workspace, source, live ? "live" : "settled"] as const,
  mentionFiles: ["files", "mentions"] as const,
  workspaceFile: (path: string) => ["files", "document", path] as const,
  workspaceSearch: (workspace: string, input: { readonly query: string } | undefined) =>
    ["files", "search", workspace, input] as const,
  browserFrame: (surface: string, url: string) => ["browser", "frame", surface, url] as const,
  browserHistory: (owner: string | null) => ["browser", "history", owner] as const,
  mermaid: (source: string) => ["mermaid", source] as const,
  highlight: (language: string, code: string) => ["highlight", language, code] as const,
};
