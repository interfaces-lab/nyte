import type { WorkspaceBackend } from "@nyte-ai/core";
import { createGitVcs } from "./git.ts";
import { discoverMentionFiles, rankMentionFiles } from "./mention-files.ts";
import {
  blameWorkspaceFile,
  formatWorkspaceFile,
  readWorkspaceFile,
  saveWorkspaceFile,
} from "./workspace-files.ts";
import { searchWorkspaceFiles } from "./workspace-search.ts";
import type { WorkspaceStore } from "./workspace-store.ts";

export function createWorkspaceBackend(workspaces: WorkspaceStore): WorkspaceBackend {
  return {
    list: () => workspaces.list(),
    touch: (path, now) => workspaces.touch(path, now),
    forget: (path) => workspaces.forget(path),
    files: async ({ cwd, query, signal }) => {
      const found = await discoverMentionFiles(cwd, signal);

      return query === undefined ? found : rankMentionFiles(found, query);
    },
    read: ({ cwd, path }) => readWorkspaceFile(cwd, path),
    save: ({ cwd, ...input }) => saveWorkspaceFile(cwd, input),
    format: ({ cwd, ...input }) => formatWorkspaceFile(cwd, input),
    search: ({ cwd, ...input }) => searchWorkspaceFiles(cwd, input),
    blame: ({ cwd, path }) => blameWorkspaceFile(cwd, path),
    vcs: createGitVcs(),
  };
}
