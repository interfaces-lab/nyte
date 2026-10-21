import {
  keepPreviousData,
  mutationOptions,
  useMutationState,
  useQuery,
} from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import type {
  ConfigurationPatch,
  ModelRef,
  SessionId,
  SessionInfo,
  SessionView,
  Thinking,
} from "@nyte-ai/sdk";
import { mainHead } from "@nyte-ai/plugin/client/presentation";
import { keys } from "./query-keys.ts";
import { connected, connection, sessionWatch } from "./sdk.tsx";

export type ConfigureSessionPatch = Pick<ConfigurationPatch, "model" | "thinking">;

export type PendingConfiguration = MutationState<void, Error, ConfigureSessionPatch>;

interface SessionChoice {
  readonly model: ModelRef | undefined;
  readonly thinking: Thinking | undefined;
}

export function projectSessionChoice(
  view: Pick<SessionView, "configuration">,
  pending: readonly PendingConfiguration[],
): SessionChoice {
  const stored = view.configuration.selected ?? view.configuration.effective;

  return pending.reduce<SessionChoice>(
    (current, mutation) => ({
      model: mutation.variables?.model ?? current.model,
      thinking:
        mutation.variables?.thinking === undefined
          ? current.thinking
          : (mutation.variables.thinking ?? undefined),
    }),
    { model: stored?.model, thinking: stored?.thinking },
  );
}

/** A child's model and thinking without watching it: its run's configuration while one runs, else its stored configuration, read once per run it finishes. */
export function useChildChoice(child: SessionInfo): SessionChoice | undefined {
  const execution = mainHead(child)?.execution;

  const stored = useQuery({
    queryKey: keys.sessionConfiguration(child.id, child.lastActivityAt),
    queryFn: async () =>
      (await (await connected()).session(child.id).view({ tail: 0 })).configuration,
    placeholderData: keepPreviousData,
  });

  const pending = useMutationState<PendingConfiguration>({
    filters: { mutationKey: ["session", child.id, "configure"], status: "pending" },
  });

  const configuration =
    execution === undefined || execution.kind === "idle"
      ? stored.data
      : { selected: null, effective: execution.run.configuration };

  return configuration === undefined ? undefined : projectSessionChoice({ configuration }, pending);
}

export function sessionConfigurationOptions({ sessionId }: { readonly sessionId: SessionId }) {
  return mutationOptions({
    mutationKey: ["session", sessionId, "configure"],
    networkMode: "always",
    mutationFn: async (patch: ConfigureSessionPatch) => {
      const next = sessionWatch(sessionId).next();
      const outcome = await connection().session(sessionId).configure(patch);

      if (outcome.kind !== "configured")
        throw new Error("That model setting is no longer available");
      await next;
    },
  });
}
