import { skipToken, useQuery } from "@tanstack/react-query";
import type { GitHubRepository, WorkspaceId } from "@nyte-ai/sdk";
import { GitHubRepositoryType } from "@nyte-ai/schema";
import { localArea, readStored, removeStored, writeStored } from "../lib/storage.ts";
import { connected } from "./connection.ts";
import { keys } from "./query-client.ts";

export function useGitHubRepository(
  workspace: WorkspaceId | undefined,
): GitHubRepository | undefined {
  const repository = useQuery({
    queryKey: keys.githubRepository(workspace),
    queryFn:
      workspace === undefined
        ? skipToken
        : async () => {
            const github = await (await connected()).workspace(workspace).github();
            const found = github.kind === "available" ? await github.api.repository() : null;

            if (found === null) removeStored(localArea(), lastRepositoryKey(workspace));
            else writeStored(localArea(), lastRepositoryKey(workspace), found);

            return found;
          },
    placeholderData: () =>
      workspace === undefined
        ? undefined
        : readStored(localArea(), lastRepositoryKey(workspace), GitHubRepositoryType, undefined),
  });

  return repository.data ?? undefined;
}

function lastRepositoryKey(workspace: WorkspaceId): string {
  return `nyte:github:repository:v1:${workspace}`;
}
