import {
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { SdkError } from "@nyte-ai/sdk";
import type { GitHubAccountState, GitHubApi, GitHubRepository, WorkspaceId } from "@nyte-ai/sdk";
import { GitHubRepositoryType } from "@nyte-ai/schema";
import { keys } from "../data/query-client.ts";
import { localArea, readStored, removeStored, writeStored } from "../lib/storage.ts";
import { nyte } from "../contract/nyte.ts";
import { connected } from "../data/connection.ts";
import { startupReadsReleased } from "../data/startup.ts";

const SIGNING_IN_POLL_MS = 2_000;

const CHECKS_POLL_MS = 15_000;

const AUTH_KEY = ["github-auth"];

export function signOutDescription(login: string): string {
  return nyte.clientSurface === "web"
    ? `This removes the CLI login for @${login} on the machine running the server. Terminal commands and other apps using this login there will also be signed out.`
    : `This removes the CLI login for @${login} on github.com. Terminal commands and other apps using this login will also be signed out.`;
}

function usePendingAuth() {
  return useMutationState({
    filters: { mutationKey: AUTH_KEY, status: "pending" },
    select: (mutation) => mutation.state.variables,
  });
}

export function useGitHub(workspace: WorkspaceId | undefined): GitHubApi | undefined {
  const capability = useQuery({
    queryKey: keys.githubCapability(workspace),
    queryFn:
      workspace === undefined
        ? skipToken
        : async () => {
            const found = await (await connected()).workspace(workspace).github();

            return found.kind === "available" ? found.api : null;
          },
  });

  return capability.data ?? undefined;
}

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
    staleTime: 30_000,
  });

  return repository.data ?? undefined;
}

function lastRepositoryKey(workspace: WorkspaceId): string {
  return `nyte:github:repository:v1:${workspace}`;
}

export function useGitHubState(workspace: WorkspaceId | undefined, github: GitHubApi | undefined) {
  return useQuery({
    queryKey: keys.githubState(workspace),
    queryFn:
      github === undefined
        ? skipToken
        : async () => {
            await startupReadsReleased();

            return github.state();
          },
    staleTime: 30_000,
    refetchOnMount: true,
    refetchInterval: (current): number | false => {
      const pullRequest = current.state.data?.pullRequest;

      return pullRequest?.kind === "ready" &&
        pullRequest.pullRequest.checks.some((check) => check.state === "pending")
        ? CHECKS_POLL_MS
        : false;
    },
  });
}

export function useGitHubAccountState() {
  return useQuery({
    queryKey: keys.githubAccount,
    queryFn: async (): Promise<GitHubAccountState | null> => {
      try {
        return await (await connected()).github.account();
      } catch (error) {
        if (error instanceof SdkError && error.code === "unavailable") return null;

        throw error;
      }
    },
    refetchInterval: (current) =>
      current.state.data?.kind === "signing_in" ? SIGNING_IN_POLL_MS : false,
  });
}

export function useGitHubAuth() {
  const client = useQueryClient();

  const auth = useMutation({
    mutationKey: AUTH_KEY,
    scope: { id: "github-auth" },
    mutationFn: async (operation: "signIn" | "signOut"): Promise<GitHubAccountState> => {
      const state = await (await connected()).github[operation]();

      if (state.kind === "error") throw new Error(state.message);

      return state;
    },
    onMutate: () =>
      Promise.all([
        client.cancelQueries({ queryKey: keys.githubAccount }),
        client.cancelQueries({ queryKey: keys.github }),
      ]),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.githubAccount }),
        client.invalidateQueries({ queryKey: keys.github }),
      ]),
  });

  const pending = usePendingAuth();

  return { auth, busy: pending.length > 0, connecting: pending.includes("signIn") };
}

export function useGitHubAccount() {
  return { query: useGitHubAccountState(), ...useGitHubAuth() };
}
