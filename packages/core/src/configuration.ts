import { clampThinkingLevel, getSupportedThinkingLevels } from "@nyte-ai/ai/models";
import type { Models } from "@nyte-ai/ai";
import type {
  Configuration,
  ConfigurationPatch,
  ConfigureOutcome,
  Json,
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
import type { PluginRuntime } from "./plugin-runtime.ts";

/** Returns what a configuration resolves against: the agents and setting definitions a session's plugins contribute. */
export type Contributions = {
  readonly agents: readonly Agent[];
  readonly settings: readonly SettingDefinition[];
};

/** Returns what `resolveConfiguration` answers short of a configuration. */
type Refusal = Exclude<ConfigureOutcome, { readonly kind: "configured" }>;

/** Returns the resolver admission, `configure` and `sessions.create` call: what `kernel.resolveConfiguration` holds. An exact `Configuration` patch is checked, never re-resolved: its model must still be in the catalog (`unknown-model`), its agent among the contributions (`unknown-agent`), and its `settingsVersion` equal to `settingsVersion(contributions.settings)` (`invalid` with one issue at `settingsVersion` otherwise). A `ConfigurationPatch` (or none) resolves field by field over `selected`. Agent: `patch.agent` when given (null clears it to the built-in agent), else `selected.agent`, else null; a non-null id `contributions.agents` does not hold is `unknown-agent`. Model: `patch.model`, else `selected.model`, else the agent's pinned `model`, else `defaultModel`; a ref `models.getModel` does not know is `unknown-model` (a fast sibling `<id>-fast` is a model like any other). Thinking: `patch.thinking` when a level is given, `invalid` at `thinking` when the model's `ModelInfo.thinking` lacks it; null, or no level given or kept, resolves the model's default, the first level after `"off"` in `ModelInfo.thinking` when the model reasons and `"off"` otherwise; a level kept from `selected` that the model no longer accepts is clamped to the nearest it accepts (ai's `clampThinkingLevel`). Settings: `selected.settings` with `patch.settings` merged over it per key; each key must name a session-scope `SettingDefinition` among `contributions.settings` and its value pass that schema, every failure an issue at `settings.<id>`, together `invalid { issues }`. The result is `{ kind: "exact", model, thinking, agent, settings, settingsVersion }` with the contributions' current `settingsVersion`; the caller passes the contributions (`contributionsOf` its runtime, or `staticContributions` while `sessions.create` writes the session). */
export function createConfigurationResolver(kernel: Kernel, models: Models): ConfigurationResolver {
  return async ({ selected, patch, contributions }) => {
    const version = await settingsVersion(contributions.settings);
    const { agents } = contributions;

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

    return resolvePatch(kernel, models, {
      selected,
      patch: patch ?? {},
      version,
      contributions,
    });
  };
}

/**
 * Returns the version of a session's setting schemas: `objectId` of the session-scope
 * `SettingDefinition`s among `settings`, each as `{ id, schema }` with the schema's output JSON
 * Schema (`jsonSchemaOf`), sorted by id. A `Configuration` carrying another version is rejected,
 * never re-resolved.
 */
export function settingsVersion(settings: readonly SettingDefinition[]): Promise<string> {
  const schemas = sessionScoped(settings)
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
    readonly selected: Configuration | null;
    readonly patch: ConfigurationPatch;
    readonly version: string;
    readonly contributions: Contributions;
  },
): Promise<Configuration | Refusal> {
  const { selected, patch } = input;
  const agent = patch.agent === undefined ? (selected?.agent ?? null) : patch.agent;
  const pinned =
    agent === null ? undefined : input.contributions.agents.find((entry) => entry.id === agent);

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
  const definitions = sessionScoped(input.contributions.settings);

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

/** Returns the session-scope setting definitions among `settings`. */
function sessionScoped(settings: readonly SettingDefinition[]): readonly SettingDefinition[] {
  return settings.filter((definition) => definition.scope === "session");
}

/** Returns a session runtime's registries as what its configuration resolves against. */
export function contributionsOf(runtime: PluginRuntime): Contributions {
  return { agents: runtime.registries.agents.list(), settings: runtime.registries.settings.list() };
}

/** Returns the static contributions of `kernel.builtins` then `kernel.hostPlugins`: what a session `sessions.create` is still writing will load, so its configuration resolves before it has a runtime. */
export function staticContributions(kernel: Kernel): Contributions {
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
