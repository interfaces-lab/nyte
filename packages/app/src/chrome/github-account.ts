import {
  skipToken,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { GitHubBridge } from "../bridge.ts";
import { keys, useHostState } from "../queries.ts";
import { nyte } from "../nyte.ts";

const SIGNING_IN_POLL_MS = 2_000;

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

/** The account and repository behind the selected workspace. Nothing is read where the host has no GitHub. */
export function useGitHubState(github: GitHubBridge | undefined) {
  const host = useHostState();
  const pending = usePendingAuth();

  return useQuery({
    queryKey: [...keys.github, host.data?.workspace?.path ?? null],
    queryFn: github === undefined ? skipToken : () => github.state(),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: pending.length === 0,
    // A sign-in ends when the code is entered on GitHub, which nothing here hears.
    refetchInterval: (current) =>
      current.state.data?.kind === "signing_in" ? SIGNING_IN_POLL_MS : false,
  });
}

/** Account credentials are shared; repository details follow the selected workspace. */
export function useGitHubAccount(github: GitHubBridge) {
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
    // Auth may finish after a workspace switch. Re-read the current target instead of caching its result.
    onSettled: () => client.invalidateQueries({ queryKey: keys.github }),
  });

  const pending = usePendingAuth();
  const query = useGitHubState(github);

  return { query, auth, busy: pending.length > 0, connecting: pending.includes("signIn") };
}
