import type { GitStatus, HostView, JobView, McpView, WorkspaceId } from "@nyte-ai/sdk";
import { startupReadsReleased } from "./startup.ts";
import { watchFamily } from "./watch-store.ts";

export const hostWatch = watchFamily((current, _key: "host"): AsyncIterable<HostView> =>
  current.watch(),
);

export const jobsWatch = watchFamily(
  (current, workspace: WorkspaceId): AsyncIterable<readonly JobView[]> =>
    current.workspace(workspace).jobs.watch(),
);

export const mcpWatch = watchFamily((current, workspace: WorkspaceId): AsyncIterable<McpView> =>
  current.workspace(workspace).mcp.watch(),
);

export const gitStatusWatch = watchFamily(
  (current, workspace: WorkspaceId): AsyncIterable<GitStatus> =>
    (async function* () {
      await startupReadsReleased();
      const git = await current.workspace(workspace).git();

      if (git.kind === "available") yield* git.api.watch();
    })(),
);
