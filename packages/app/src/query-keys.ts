import type { GitScope, RunId, SessionId, WorkspaceId } from "@nyte-ai/sdk";

export const keys = {
  host: ["host"] as const,
  hostSettings: ["host-settings"] as const,
  updates: ["updates"] as const,
  workspaces: ["workspaces"] as const,
  modelCatalog: (generation: string) => ["catalog", "models", generation] as const,
  accountLimits: (generation: string) => ["account-limits", generation] as const,
  // Usage reads everything once. A read walks every stored commit whatever
  // window it is asked for, so the window buys nothing on the way in and costs
  // a full re-read on every range press. The day is the key, so the page reads
  // again after midnight and not before.
  usage: (untilDay: string) => ["usage", untilDay] as const,
  github: ["github"] as const,
  server: ["server"] as const,
  remoteAccess: ["remote-access"] as const,
  // Under remoteAccess, so `remote_access_changed` re-reads it too.
  connect: ["remote-access", "connect"] as const,
  session: (sessionId: SessionId) => ["session", sessionId] as const,
  gitChanges: (
    workspace: WorkspaceId | undefined,
    scope: GitScope | undefined,
    ignoreWhitespace: boolean,
    revision: string | undefined,
  ) => ["git", "changes", workspace, scope, ignoreWhitespace, revision] as const,
  gitLog: (workspace: WorkspaceId | undefined, limit: number, cursor: string | undefined) =>
    ["git", "log", workspace, limit, cursor] as const,
  gitRefs: (workspace: WorkspaceId | undefined) => ["git", "refs", workspace] as const,
  runChanges: (workspace: WorkspaceId | undefined, run: RunId | undefined, live: boolean) =>
    ["git", "run", workspace, run, live ? "live" : "settled"] as const,
  mentionFiles: ["files", "mentions"] as const,
  workspaceFile: (path: string) => ["files", "document", path] as const,
  workspaceSearch: (workspace: string, input: { readonly query: string } | undefined) =>
    ["files", "search", workspace, input] as const,
  browserFrame: (surface: string, url: string) => ["browser", "frame", surface, url] as const,
  browserHistory: (owner: string | null) => ["browser", "history", owner] as const,
  mermaid: (source: string) => ["mermaid", source] as const,
  highlight: (language: string, code: string) => ["highlight", language, code] as const,
};
