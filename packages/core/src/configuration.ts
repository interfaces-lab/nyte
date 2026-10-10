import type { Models } from "@nyte-ai/ai";
import type { SessionId } from "@nyte-ai/schema";
import type { ConfigurationResolver, Kernel } from "./kernel.ts";

/** Returns the resolver admission, `configure` and `sessions.create` call: what `kernel.resolveConfiguration` holds. An exact `Configuration` patch is checked, never re-resolved: its model must still be in the catalog (`unknown-model`), its agent registered (`unknown-agent`), and its `settingsVersion` equal to `settingsVersion(kernel, session)` (`invalid` with one issue at `settingsVersion` otherwise). A `ConfigurationPatch` (or none) resolves field by field over `selected`. Agent: `patch.agent` when given (null clears it to the built-in agent), else `selected.agent`, else null; a non-null id the session's `agents` registry does not hold is `unknown-agent`. Model: `patch.model`, else `selected.model`, else the agent's pinned `model`, else `defaultModel`; a ref `models.getModel` does not know is `unknown-model` (a fast sibling `<id>-fast` is a model like any other). Thinking: `patch.thinking` when a level is given, `invalid` at `thinking` when the model's `ModelInfo.thinking` lacks it; null, or no level given or kept, resolves the model's default, the first level after `"off"` in `ModelInfo.thinking` when the model reasons and `"off"` otherwise; a level kept from `selected` that the model no longer accepts is clamped to the nearest it accepts (ai's `clampThinkingLevel`). Settings: `selected.settings` with `patch.settings` merged over it per key; each key must name a session-scope `SettingDefinition` in the session's `settings` registry and its value pass that schema, every failure an issue at `settings.<id>`, together `invalid { issues }`. The result is `{ kind: "exact", model, thinking, agent, settings, settingsVersion }` with the session's current `settingsVersion`. */
export function createConfigurationResolver(kernel: Kernel, models: Models): ConfigurationResolver {
  throw new Error("not implemented");
}

/** Returns the version of a session's setting schemas: `objectId` of the session-scope `SettingDefinition`s its `settings` registry holds, each as `{ id, schema }` with the schema's output JSON Schema (`jsonSchemaOf`), sorted by id. A `Configuration` carrying another version is rejected, never re-resolved. */
export function settingsVersion(kernel: Kernel, session: SessionId): Promise<string> {
  throw new Error("not implemented");
}
