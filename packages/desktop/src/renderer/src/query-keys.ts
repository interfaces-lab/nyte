import type { SessionId } from "@nyte-ai/core";

export const keys = {
  host: ["host"] as const,
  workspaces: ["workspaces"] as const,
  sessions: ["sessions"] as const,
  sessionPreview: ["sessions", "preview"] as const,
  sessionDirectory: ["sessions", "directory"] as const,
  sessionSearch: (search: string) => ["sessions", "search", search] as const,
  catalog: ["catalog"] as const,
  pluginCatalog: ["plugins", "catalog"] as const,
  github: ["github"] as const,
  session: (sessionId: SessionId) => ["session", sessionId] as const,
  children: (sessionId: SessionId) => ["children", sessionId] as const,
  snapshot: (sessionId: SessionId) => ["snapshot", sessionId] as const,
  changes: (sessionId: SessionId) => ["changes", sessionId] as const,
  pluginSettings: (sessionId: SessionId) => ["plugins", "settings", sessionId] as const,
  workspaceChanges: ["changes", { kind: "workspace" }] as const,
  vcsSnapshot: ["vcs", "snapshot"] as const,
  mentionFiles: ["files", "mentions"] as const,
  vcsDiff: (repositoryId: string, revision: string, path: string) =>
    ["vcs", "diff", repositoryId, revision, path] as const,
};
