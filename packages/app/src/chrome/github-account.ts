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

/** Checks on a pull request finish on GitHub, which nothing here hears, so pending ones poll. */
const CHECKS_POLL_MS = 15_000;

const AUTH_KEY = ["github-auth"];

const ACCOUNT_KEY = [...keys.github, "account"];

/** What signing out removes, said where the user decides. */
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

/**
 * GitHub on the host for the selected folder; absent with no folder selected,
 * until the host answers, and where it serves no GitHub. The api is bound to
 * this connection, so it lives under the keys a host change clears.
 */
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

/** The selected workspace's repository and branch pull request. Running checks finish on GitHub, which nothing here hears, so they poll. */
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

/** The machine's GitHub CLI login, or null where the host serves none. A sign-in ends when the code is entered on GitHub, which nothing here hears, so a pending one polls. */
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

/** The machine's GitHub CLI login with signing in and out; one for every folder, so it reads no workspace. */
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
