import { mutationOptions } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import type { ConfigurationPatch, ModelRef, SessionId, SessionView, Thinking } from "@nyte-ai/sdk";
import { connection, sessionWatch } from "./sdk.tsx";

export type ConfigureSessionPatch = Pick<ConfigurationPatch, "model" | "thinking">;

export type PendingConfiguration = MutationState<void, Error, ConfigureSessionPatch>;

export interface SessionChoice {
  readonly model: ModelRef | undefined;
  readonly thinking: Thinking | undefined;
}

export function projectSessionChoice(
  view: SessionView,
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
