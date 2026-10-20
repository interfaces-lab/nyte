import {
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { SdkError } from "@nyte-ai/sdk";
import type { GitHubAccountState, GitHubApi } from "@nyte-ai/sdk";
import { keys, useHostState } from "../queries.ts";
import { nyte } from "../nyte.ts";
import { connected } from "../sdk.tsx";
import { startupReadsReleased } from "../startup.ts";

const SIGNING_IN_POLL_MS = 2_000;

const CHECKS_POLL_MS = 15_000;

const AUTH_KEY = ["github-auth"];

const ACCOUNT_KEY = [...keys.github, "account"];

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

export function useGitHub(): GitHubApi | undefined {
  const workspace = useHostState().data.workspace?.id;

  const capability = useQuery({
    queryKey: [...keys.github, "capability", workspace],
    queryFn:
      workspace === undefined
        ? skipToken
        : async () => {
            const found = await (await connected()).workspace(workspace).github();

            return found.kind === "available" ? found.api : null;
          },
    staleTime: Number.POSITIVE_INFINITY,
  });

  return capability.data ?? undefined;
}

export function useGitHubState(github: GitHubApi | undefined) {
  const host = useHostState();

  return useQuery({
    queryKey: [...keys.github, host.data.workspace?.path ?? null],
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
  const pending = usePendingAuth();

  return useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: async (): Promise<GitHubAccountState | null> => {
      try {
        return await (await connected()).github.account();
      } catch (error) {
        if (error instanceof SdkError && error.code === "unavailable") return null;

        throw error;
      }
    },
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: pending.length === 0,
    refetchInterval: (current) =>
      current.state.data?.kind === "signing_in" ? SIGNING_IN_POLL_MS : false,
  });
}

export function useGitHubAccount() {
  const client = useQueryClient();

  const auth = useMutation({
    mutationKey: AUTH_KEY,
    scope: { id: "github-auth" },
    mutationFn: async (operation: "signIn" | "signOut"): Promise<GitHubAccountState> => {
      const state = await (await connected()).github[operation]();

      if (state.kind === "error") throw new Error(state.message);

      return state;
    },
    onMutate: () => client.cancelQueries({ queryKey: keys.github }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.github }),
  });

  const pending = usePendingAuth();
  const query = useGitHubAccountState();

  return { query, auth, busy: pending.length > 0, connecting: pending.includes("signIn") };
}
