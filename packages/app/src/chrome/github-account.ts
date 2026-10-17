import {
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { GitHubApi, GitHubState } from "@nyte-ai/sdk";
import { keys, useHostState } from "../queries.ts";
import { nyte } from "../nyte.ts";
import { connected, hostWatch, useWatchSelect } from "../sdk.tsx";

const SIGNING_IN_POLL_MS = 2_000;

/** Checks on a pull request finish on GitHub, which nothing here hears, so pending ones poll. */
const CHECKS_POLL_MS = 15_000;

/** How soon the state is read again: while a sign-in waits for its code, or while checks run. */
function pollInterval(state: GitHubState | undefined): number | false {
  if (state?.kind === "signing_in") return SIGNING_IN_POLL_MS;

  if (state?.kind !== "ready" || state.pullRequest.kind !== "ready") return false;

  return state.pullRequest.pullRequest.checks.some((check) => check.state === "pending")
    ? CHECKS_POLL_MS
    : false;
}

const AUTH_KEY = ["github-auth"];

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
 * GitHub on the host for the selected folder, or for Home when none is
 * selected. Absent until the host answers, and where it serves no GitHub. The
 * api is bound to this connection, so it lives under the keys a host change
 * clears.
 */
export function useGitHub(): GitHubApi | undefined {
  const selected = useHostState().data.workspace?.id;
  const home = useWatchSelect(hostWatch("host"), (state) => state.value?.defaultWorkspace ?? null);
  const workspace = selected ?? home;

  const capability = useQuery({
    queryKey: [...keys.github, "capability", workspace],
    queryFn:
      workspace === null
        ? skipToken
        : async () => {
            const found = await (await connected()).workspace(workspace).github();

            return found.kind === "available" ? found.api : null;
          },
    staleTime: Number.POSITIVE_INFINITY,
  });

  return capability.data ?? undefined;
}

/**
 * The account and repository behind the selected workspace. Nothing is read
 * where the host has no GitHub. A sign-in ends when the code is entered on
 * GitHub, which nothing here hears, so a pending one polls, as do running checks.
 */
export function useGitHubState(github: GitHubApi | undefined) {
  const host = useHostState();
  const pending = usePendingAuth();

  return useQuery({
    queryKey: [...keys.github, host.data.workspace?.path ?? null],
    queryFn: github === undefined ? skipToken : () => github.state(),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: pending.length === 0,
    refetchInterval: (current) => pollInterval(current.state.data),
  });
}

/**
 * Account credentials are shared; repository details follow the selected
 * workspace. Auth may finish after a workspace switch, so it settles by
 * re-reading the current target instead of caching its result.
 */
export function useGitHubAccount(github: GitHubApi) {
  const client = useQueryClient();

  const auth = useMutation({
    mutationKey: AUTH_KEY,
    scope: { id: "github-auth" },
    mutationFn: async (operation: "signIn" | "signOut") => {
      const state = await github[operation]();

      if (state.kind === "error") throw new Error(state.message);

      return state;
    },
    onMutate: () => client.cancelQueries({ queryKey: keys.github }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.github }),
  });

  const pending = usePendingAuth();
  const query = useGitHubState(github);

  return { query, auth, busy: pending.length > 0, connecting: pending.includes("signIn") };
}
