import { mutationOptions } from "@tanstack/react-query";
import { compile, ConfigurationPatchType, withJson } from "@nyte-ai/schema";
import type { MutationState } from "@tanstack/react-query";
import type {
  Configuration,
  ConfigurationPatch,
  ModelRef,
  SessionId,
  SessionView,
  Thinking,
} from "@nyte-ai/sdk";
import { connection } from "./connection.ts";
import { chatStore } from "./chat-store.ts";
import { queryClient } from "./query-client.ts";

const CONFIGURE_PATCH = compile(withJson(ConfigurationPatchType));

export type ConfigureSessionPatch = Pick<ConfigurationPatch, "model" | "thinking">;

export type PendingConfiguration = MutationState<void, Error, ConfigureSessionPatch>;

interface SessionChoice {
  readonly model: ModelRef | undefined;
  readonly thinking: Thinking | undefined;
}

export function projectSessionChoice(
  view: Pick<SessionView, "configuration">,
  pending: readonly Pick<PendingConfiguration, "variables">[],
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

/** The configure mutations of `sessionId` still in flight, oldest first, for a reader outside React; `useMutationState` gives the same list to a component. */
export function pendingConfigurations(
  sessionId: SessionId,
): readonly Pick<PendingConfiguration, "variables">[] {
  return queryClient
    .getMutationCache()
    .findAll({ mutationKey: ["session", sessionId, "configure"], status: "pending" })
    .flatMap((mutation) => {
      const variables = mutation.state.variables;

      return CONFIGURE_PATCH.Check(variables) ? [{ variables }] : [];
    });
}

/** Whether `view` shows `selected`'s model and thinking, the parts of a configuration the chat shows. */
export function showsChoice(
  view: Pick<SessionView, "configuration">,
  selected: Pick<Configuration, "model" | "thinking">,
): boolean {
  const shown = projectSessionChoice(view, []);

  return (
    shown.model?.provider === selected.model.provider &&
    shown.model.id === selected.model.id &&
    shown.thinking === selected.thinking
  );
}

/** The longest a chosen model shows over the chat after the host has taken it, while the chat's view has yet to show it. */
const SHOWN_WITHIN_MS = 2_000;

/** Each chat's latest answered choice still waiting for its view. */
const waits = new Map<SessionId, AbortController>();

/** The pending choice overlays the chat until its view shows what the host configured, or `SHOWN_WITHIN_MS` passes, or the chat's store fails, or a later choice is answered, so a pick back to the model the view still shows can't leave the earlier pick showing; the wait starts only once the host has answered. */
export function sessionConfigurationOptions({ sessionId }: { readonly sessionId: SessionId }) {
  return mutationOptions({
    mutationKey: ["session", sessionId, "configure"],
    networkMode: "always",
    mutationFn: async (patch: ConfigureSessionPatch) => {
      const outcome = await connection().session(sessionId).configure(patch);

      if (outcome.kind !== "configured")
        throw new Error("That model setting is no longer available");
      waits.get(sessionId)?.abort();
      const bound = new AbortController();
      waits.set(sessionId, bound);
      const timer = setTimeout(() => bound.abort(), SHOWN_WITHIN_MS);

      await chatStore(sessionId)
        .until((view) => showsChoice(view, outcome.selected), bound.signal)
        .catch(() => undefined);
      clearTimeout(timer);

      if (waits.get(sessionId) === bound) waits.delete(sessionId);
    },
  });
}
