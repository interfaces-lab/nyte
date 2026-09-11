import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, useHostState } from "../queries.ts";
import { nyte } from "../nyte.ts";

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
  });
  return { query, auth, busy: pending.length > 0, connecting: pending.includes("signIn") };
}
