import { mutationOptions } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import type { ConfigurationPatch, ModelRef, SessionId, SessionView, Thinking } from "@nyte-ai/sdk";
import { connection, sessionWatch } from "./sdk.tsx";

/** The part of a head's selection the pickers change. */
export type ConfigureSessionPatch = Pick<ConfigurationPatch, "model" | "thinking">;

/** A configure request still in flight, painted over the view until the next view arrives. */
export type PendingConfiguration = MutationState<void, Error, ConfigureSessionPatch>;

/** The model and thinking level a session's pickers show. */
export interface SessionChoice {
  readonly model: ModelRef | undefined;
  readonly thinking: Thinking | undefined;
}

/**
 * The view's selection, else what admission would resolve, with every
 * pending choice painted over it in call order. A choice stops painting once
 * the session's next view arrives after the host answered it.
 */
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

/** Configures the session's main head and resolves once the view that follows the answer has arrived. */
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
