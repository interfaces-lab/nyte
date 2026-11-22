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
import type { Json } from "@nyte-ai/schema";
import { connection } from "./connection.ts";
import { chatStore } from "./chat-store.ts";
import { queryClient } from "./query-client.ts";

const CONFIGURE_PATCH = compile(withJson(ConfigurationPatchType));

export type ConfigureSessionPatch = Pick<ConfigurationPatch, "model" | "thinking" | "settings">;

export type PendingConfiguration = MutationState<void, Error, ConfigureSessionPatch>;

interface SessionChoice {
  readonly model: ModelRef | undefined;
  readonly thinking: Thinking | undefined;
  readonly settings: Readonly<Record<string, Json>>;
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
      settings: { ...current.settings, ...mutation.variables?.settings },
    }),
    { model: stored?.model, thinking: stored?.thinking, settings: stored?.settings ?? {} },
  );
}

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

export function showsChoice(
  view: Pick<SessionView, "configuration">,
  selected: Pick<Configuration, "model" | "thinking" | "settings">,
): boolean {
  const shown = projectSessionChoice(view, []);

  return (
    shown.model?.provider === selected.model.provider &&
    shown.model.id === selected.model.id &&
    shown.thinking === selected.thinking &&
    Object.entries(selected.settings).every(
      ([id, value]) => JSON.stringify(shown.settings[id]) === JSON.stringify(value),
    )
  );
}

const SHOWN_WITHIN_MS = 2000;

const waits = new Map<SessionId, AbortController>();

export function sessionConfigurationOptions({ sessionId }: { readonly sessionId: SessionId }) {
  return mutationOptions({
    mutationKey: ["session", sessionId, "configure"],
    networkMode: "always",
    mutationFn: async (patch: ConfigureSessionPatch) => {
      const outcome = await connection().session(sessionId).configure(patch);

      if (outcome.kind !== "configured") {
        throw new Error("That setting is no longer available");
      }
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
