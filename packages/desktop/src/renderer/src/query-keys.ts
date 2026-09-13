import type { SessionId } from "@nyte-ai/core";
import type { WorkspaceSearchInput } from "../../shared/workspace-editor.ts";

export const keys = {
  host: ["host"] as const,
  workspaces: ["workspaces"] as const,
  sessions: ["sessions"] as const,
  sessionPreview: ["sessions", "preview"] as const,
  sessionDirectory: ["sessions", "directory"] as const,
  sessionSearch: (search: string) => ["sessions", "search", search] as const,
  catalog: ["catalog"] as const,
  sessionCatalog: (sessionId: SessionId) => ["catalog", "session", sessionId] as const,
  // Usage reads everything once. A read walks every stored commit whatever
  // window it is asked for, so the window buys nothing on the way in and costs
  // a full re-read on every range press. The day is the key, so the page reads
  // again after midnight and not before.
  usage: (untilDay: string) => ["usage", untilDay] as const,
  accountLimits: ["usage", "account-limits"] as const,
  pluginCatalog: ["plugins", "catalog"] as const,
  github: ["github"] as const,
  server: ["server"] as const,
  mobileShare: ["mobile-share"] as const,
  session: (sessionId: SessionId) => ["session", sessionId] as const,
  jobs: (sessionId: SessionId | undefined) => ["jobs", sessionId] as const,
  children: (sessionId: SessionId) => ["children", sessionId] as const,
  snapshot: (sessionId: SessionId) => ["snapshot", sessionId] as const,
  pluginSettings: (sessionId: SessionId) => ["plugins", "settings", sessionId] as const,
  vcsSnapshot: ["vcs", "snapshot"] as const,
  mentionFiles: ["files", "mentions"] as const,
  workspaceFile: (path: string) => ["files", "document", path] as const,
  workspaceSearch: (
    workspacePath: string,
    input: Omit<WorkspaceSearchInput, "requestId"> | undefined,
  ) => ["files", "search", workspacePath, input] as const,
  vcsDiffs: (repositoryId: string, revision: string, pathsKey: string) =>
    ["vcs", "diffs", repositoryId, revision, pathsKey] as const,
};
