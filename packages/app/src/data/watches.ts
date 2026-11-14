import type { GitStatus, HostView, JobView, McpView, WorkspaceId } from "@nyte-ai/sdk";
import { startupReadsReleased } from "./startup.ts";
import { watchFamily } from "./watch-store.ts";
import type { Stream } from "./watch-store.ts";

/** What a folder with no git to read shows: no repository, for good, until the store opens again. */
async function* noGit(): AsyncIterable<GitStatus> {
  yield { kind: "none" };
}

/** The host's watches end only when their link closes; each opens again on the reopen backoff, which a replaced connection cuts short. */
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
