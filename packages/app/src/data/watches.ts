import type {
  GitStatus,
  HostView,
  JobView,
  LanguageServerView,
  McpView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { startupReadsReleased } from "./startup.ts";
import { watchFamily } from "./watch-store.ts";
import type { Stream } from "./watch-store.ts";

async function* noGit(): AsyncIterable<GitStatus> {
  yield { kind: "none" };
}

async function* noServers(): AsyncIterable<readonly LanguageServerView[]> {
  yield [];
}

export const hostWatch = watchFamily((current, _key: "host"): Stream<HostView> => ({
  values: current.watch(),
  ended: "reopen",
}));

export const jobsWatch = watchFamily(
  (current, workspace: WorkspaceId): Stream<readonly JobView[]> => ({
    values: current.workspace(workspace).jobs.watch(),
    ended: "reopen",
  }),
);

export const mcpWatch = watchFamily((current, workspace: WorkspaceId): Stream<McpView> => ({
  values: current.workspace(workspace).mcp.watch(),
  ended: "reopen",
}));

export const gitStatusWatch = watchFamily(
  async (current, workspace: WorkspaceId): Promise<Stream<GitStatus>> => {
    await startupReadsReleased();
    const git = await current.workspace(workspace).git();

    return git.kind === "available"
      ? { values: git.api.watch(), ended: "reopen" }
      : { values: noGit(), ended: "finished" };
  },
);

export const languageStatusWatch = watchFamily(
  async (current, workspace: WorkspaceId): Promise<Stream<readonly LanguageServerView[]>> => {
    const language = await current.workspace(workspace).language();

    return language.kind === "available"
      ? { values: language.api.watchStatus(), ended: "reopen" }
      : { values: noServers(), ended: "finished" };
  },
);
