/** Node/Bun workspace file operations for hosts. */
export { discoverMentionFiles } from "./mention-files.ts";
export type { MentionFile } from "./mention-files.ts";
export {
  MAX_WORKSPACE_FILE_BYTES,
  readWorkspaceFile,
  saveWorkspaceFile,
  resolveWorkspaceFile,
  WorkspaceFileError,
} from "./workspace-files.ts";
export type { WorkspaceFileDocument, WorkspaceFileSaveOutcome } from "./workspace-files.ts";
export {
  searchWorkspaceFiles,
  WorkspaceSearchSchema,
  WorkspaceSearchError,
} from "./workspace-search.ts";
export type {
  WorkspaceSearchInput,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from "./workspace-search.ts";
