import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, useHostState } from "../queries.ts";
import { nyte } from "../nyte.ts";

const SIGNING_IN_POLL_MS = 2_000;

/** What signing out removes, said where the user decides. */
export function signOutDescription(login: string): string {
  return nyte.clientSurface === "web"
    ? `This removes the CLI login for @${login} on the machine running the server. Terminal commands and other apps using this login there will also be signed out.`
    : `This removes the CLI login for @${login} on github.com. Terminal commands and other apps using this login will also be signed out.`;
}

/** Account credentials are shared; repository details follow the selected workspace. */
export function useGitHubAccount() {
  const client = useQueryClient();
  const host = useHostState();

  const auth = useMutation({
    mutationKey: ["github-auth"],
    scope: { id: "github-auth" },
    mutationFn: async (operation: "signIn" | "signOut") => {
      const state = await nyte.host.github[operation]();

      if (state.kind === "error") throw new Error(state.message);

      return state;
    },
    onMutate: () => client.cancelQueries({ queryKey: keys.github }),
    // Auth may finish after a workspace switch. Re-read the current target instead of caching its result.
    onSettled: () => client.invalidateQueries({ queryKey: keys.github }),
  });

  const pending = useMutationState({
    filters: { mutationKey: ["github-auth"], status: "pending" },
    select: (mutation) => mutation.state.variables,
  });

  const query = useQuery({
    queryKey: [...keys.github, host.data?.workspace?.path ?? null],
    queryFn: () => nyte.host.github.state(),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: pending.length === 0,
    // A sign-in ends when the code is entered on GitHub, which nothing here hears.
    refetchInterval: (current) =>
      current.state.data?.kind === "signing_in" ? SIGNING_IN_POLL_MS : false,
  });

  return { query, auth, busy: pending.length > 0, connecting: pending.includes("signIn") };
}
