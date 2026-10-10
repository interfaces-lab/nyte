import { clampThinkingLevel, getSupportedThinkingLevels } from "@nyte-ai/ai/models";
import type { Models } from "@nyte-ai/ai";
import type {
  Configuration,
  ConfigurationPatch,
  ConfigureOutcome,
  Json,
  SessionId,
  Thinking,
  ValidationIssue,
} from "@nyte-ai/schema";
import type { Api, Model } from "@nyte-ai/schema/model";
import { jsonSchemaOf } from "./catalog.ts";
import { objectId } from "./content.ts";
import { check } from "./json-schema.ts";
import type { ConfigurationResolver, Kernel } from "./kernel.ts";
import { defaultModel } from "./models.ts";
import type { Agent, SettingDefinition } from "./plugin.ts";

/** Returns what `resolveConfiguration` answers short of a configuration. */
type Refusal = Exclude<ConfigureOutcome, { readonly kind: "configured" }>;

/** Returns the resolver admission, `configure` and `sessions.create` call: what `kernel.resolveConfiguration` holds. An exact `Configuration` patch is checked, never re-resolved: its model must still be in the catalog (`unknown-model`), its agent registered (`unknown-agent`), and its `settingsVersion` equal to `settingsVersion(kernel, session)` (`invalid` with one issue at `settingsVersion` otherwise). A `ConfigurationPatch` (or none) resolves field by field over `selected`. Agent: `patch.agent` when given (null clears it to the built-in agent), else `selected.agent`, else null; a non-null id the session's `agents` registry does not hold is `unknown-agent`. Model: `patch.model`, else `selected.model`, else the agent's pinned `model`, else `defaultModel`; a ref `models.getModel` does not know is `unknown-model` (a fast sibling `<id>-fast` is a model like any other). Thinking: `patch.thinking` when a level is given, `invalid` at `thinking` when the model's `ModelInfo.thinking` lacks it; null, or no level given or kept, resolves the model's default, the first level after `"off"` in `ModelInfo.thinking` when the model reasons and `"off"` otherwise; a level kept from `selected` that the model no longer accepts is clamped to the nearest it accepts (ai's `clampThinkingLevel`). Settings: `selected.settings` with `patch.settings` merged over it per key; each key must name a session-scope `SettingDefinition` in the session's `settings` registry and its value pass that schema, every failure an issue at `settings.<id>`, together `invalid { issues }`. The result is `{ kind: "exact", model, thinking, agent, settings, settingsVersion }` with the session's current `settingsVersion`. A session whose plugins this process has not loaded (one `sessions.create` is still writing) reads its registries as the static contributions of `kernel.builtins` then `kernel.hostPlugins`. */
export function createConfigurationResolver(kernel: Kernel, models: Models): ConfigurationResolver {
  return async ({ session, selected, patch }) => {
    const version = await settingsVersion(kernel, session);
    const { agents } = contributed(kernel, session);

    if (patch !== null && "kind" in patch) {
      if (models.getModel(patch.model.provider, patch.model.id) === undefined)
        return { kind: "unknown-model", model: patch.model };

      if (patch.agent !== null && !agents.some((agent) => agent.id === patch.agent))
        return { kind: "unknown-agent", agent: patch.agent };

      if (patch.settingsVersion !== version)
        return invalid([
          issue(["settingsVersion"], "The host's session settings changed since it was resolved."),
        ]);

      return patch;
    }

    return resolvePatch(kernel, models, { session, selected, patch: patch ?? {}, version, agents });
  };
}

/** Returns the version of a session's setting schemas: `objectId` of the session-scope `SettingDefinition`s its `settings` registry holds, each as `{ id, schema }` with the schema's output JSON Schema (`jsonSchemaOf`), sorted by id. A `Configuration` carrying another version is rejected, never re-resolved. */
export function settingsVersion(kernel: Kernel, session: SessionId): Promise<string> {
  const schemas = sessionSettings(kernel, session)
    .flatMap((definition) => {
      try {
        return [{ id: definition.id, schema: jsonSchemaOf(definition.schema, "output") }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  return objectId(schemas);
}

/** Resolves a patch field by field over the head's selection. */
async function resolvePatch(
  kernel: Kernel,
  models: Models,
  input: {
    readonly session: SessionId;
    readonly selected: Configuration | null;
    readonly patch: ConfigurationPatch;
    readonly version: string;
    readonly agents: readonly Agent[];
  },
): Promise<Configuration | Refusal> {
  const { selected, patch } = input;
  const agent = patch.agent === undefined ? (selected?.agent ?? null) : patch.agent;
  const pinned = agent === null ? undefined : input.agents.find((entry) => entry.id === agent);

  if (agent !== null && pinned === undefined) return { kind: "unknown-agent", agent };

  const ref =
    patch.model ?? selected?.model ?? pinned?.model ?? (await defaultModel(kernel, models));

  if (ref === null)
    return invalid([issue(["model"], "No model was chosen and no provider is configured.")]);
  const model = models.getModel(ref.provider, ref.id);

  if (model === undefined) return { kind: "unknown-model", model: ref };
  const issues: ValidationIssue[] = [];
  const thinking = thinkingOf(model, patch.thinking, selected?.thinking);

  if (thinking === null) issues.push(issue(["thinking"], `${ref.id} does not accept that level.`));
  const settings: Record<string, Json> = { ...selected?.settings, ...patch.settings };
  const definitions = sessionSettings(kernel, input.session);

  for (const [id, value] of Object.entries(settings)) {
    const definition = definitions.find((entry) => entry.id === id);

    if (definition === undefined) {
      issues.push(issue(["settings", id], `No session setting is named ${id}.`));
      continue;
    }

    const checked = await check(definition.schema, value);

    if (checked.kind === "invalid")
      issues.push(
        ...checked.issues.map((found) => ({ ...found, path: ["settings", id, ...found.path] })),
      );
  }

  if (thinking === null || issues.length > 0) return invalid(issues);

  return {
    kind: "exact",
    model: ref,
    thinking,
    agent,
    settings,
    settingsVersion: input.version,
  };
}

/** Returns the thinking level a resolution lands on, or null when a level given is one the model does not accept. */
function thinkingOf(
  model: Model<Api>,
  given: Thinking | null | undefined,
  kept: Thinking | undefined,
): Thinking | null {
  const accepted: readonly Thinking[] = [
    "off",
    ...getSupportedThinkingLevels(model).filter((level) => level !== "off"),
  ];

  if (given !== undefined && given !== null) return accepted.includes(given) ? given : null;

  if (given === undefined && kept !== undefined)
    return accepted.includes(kept) ? kept : clampThinkingLevel(model, kept);

  return model.reasoning ? (accepted.find((level) => level !== "off") ?? "off") : "off";
}

/** Returns the session-scope setting definitions a session's plugins contribute. */
function sessionSettings(kernel: Kernel, session: SessionId): readonly SettingDefinition[] {
  return contributed(kernel, session).settings.filter(
    (definition) => definition.scope === "session",
  );
}

/** Returns the agents and settings a session's plugins contribute: its registries once its plugins loaded in this process, else the static contributions of the built-ins and the host plugins. */
function contributed(
  kernel: Kernel,
  session: SessionId,
): { readonly agents: readonly Agent[]; readonly settings: readonly SettingDefinition[] } {
  const runtime = kernel.runtimes().get(session);

  if (runtime?.loaded() === true)
    return {
      agents: runtime.registries.agents.list(),
      settings: runtime.registries.settings.list(),
    };

  const plugins = [...kernel.builtins, ...kernel.hostPlugins];

  return {
    agents: plugins.flatMap((plugin) => plugin.contribute?.agents ?? []),
    settings: plugins.flatMap((plugin) => plugin.contribute?.settings ?? []),
  };
}

/** Returns an `invalid` outcome. */
function invalid(issues: readonly ValidationIssue[]): Refusal {
  return { kind: "invalid", issues };
}

/** Returns an error issue at a path. */
function issue(path: readonly (string | number)[], message: string): ValidationIssue {
  return { severity: "error", path, message };
}
