import { asId, isJson } from "@nyte-ai/schema";
import type {
  CatalogGeneration,
  CommandInfo,
  JsonSchema,
  RunId,
  Schema,
  SessionCatalogView,
  SessionId,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { isJsonObject } from "./session-state.ts";
import { settingInfos } from "./settings.ts";
import type { ToolSource } from "./tool-runner.ts";

const schemas = new WeakMap<
  object,
  { readonly input?: JsonSchema; readonly output?: JsonSchema }
>();

const activated = new WeakMap<Kernel, Map<RunId, Set<string>>>();

const publishing = new WeakMap<Kernel, Map<SessionId, Promise<void>>>();

/** Returns what a session's plugins contributed, from its materialised registries, each item with its owner: commands (named `<owner>/<name>` (§35d), side `core`, `arguments` as JSON Schema or null), settings (`settingInfos`), skills, agents (`description` and `model` null when absent, `mode` default `all`) and tools (`toolSource(kernel, session, null).list()`). An item whose schema has no JSON Schema is left out. */
export async function sessionCatalog(
  kernel: Kernel,
  session: SessionId,
): Promise<SessionCatalogView> {
  const { registries } = kernel.pluginsFor(session);

  return {
    commands: registries.commands.entries().flatMap(({ item, owner }): readonly CommandInfo[] => {
      const args = item.arguments === undefined ? null : converted(item.arguments, "input");

      if (args === undefined) return [];

      return [
        {
          name: `${owner}/${item.name}`,
          owner,
          side: "core",
          title: item.title,
          description: item.description,
          arguments: args,
          category: item.category,
          keywords: item.keywords,
        },
      ];
    }),
    settings: await settingInfos(kernel, session),
    skills: registries.skills.entries().map(({ item, owner }) => ({
      name: item.name,
      owner,
      description: item.description,
      location: item.location,
    })),
    agents: registries.agents.entries().map(({ item, owner }) => ({
      id: item.id,
      owner,
      description: item.description ?? null,
      model: item.model ?? null,
      mode: item.mode ?? "all",
    })),
    tools: toolSource(kernel, session, null).list(),
  };
}

/** Computes the session's catalog and, when it differs from the one last published, sets it with `kernel.setCatalog` (which publishes the `catalog` event) and bumps `kernel.host`'s `catalog` generation. One session's publishes run one after another. The plugin runtime calls it after every reload pass; settings changes call it for every live session. */
export function publishCatalog(kernel: Kernel, session: SessionId): Promise<void> {
  const queues = publishing.get(kernel) ?? new Map<SessionId, Promise<void>>();
  publishing.set(kernel, queues);

  const next = (queues.get(session) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const catalog = await sessionCatalog(kernel, session);

      if (JSON.stringify(catalog) === JSON.stringify(kernel.catalog(session))) return;
      kernel.setCatalog(session, catalog);
      bumpGeneration(kernel);
    });

  queues.set(session, next);

  void next
    .finally(() => {
      if (queues.get(session) === next) queues.delete(session);
    })
    .catch(() => undefined);

  return next;
}

/** Moves `HostView.catalog` to a fresh generation and returns it: clients read the catalogs again. */
export function bumpGeneration(kernel: Kernel): CatalogGeneration {
  const generation = asId<"catalog-generation">(crypto.randomUUID());
  kernel.host.update({ catalog: generation });

  return generation;
}

/** Returns a session's tools for one run, from its tools registry: `get` resolves any tool by name with its owner, whatever its exposure; `list` returns each as `ToolInfo` (`namespace` the definition's or null, §48d; parameters and output through `jsonSchemaOf`, a tool whose schemas have none left out), a deferred tool activated for this run listed as `model`; `activate` marks deferred tools for this run alone (a no-op when `run` is null), kept in memory until `endRun` drops them (§35f). What `kernel.tools` returns. */
export function toolSource(kernel: Kernel, session: SessionId, run: RunId | null): ToolSource {
  const registry = kernel.pluginsFor(session).registries.tools;

  return {
    get(name) {
      const found = registry.entries().find((entry) => entry.item.name === name);

      return found === undefined ? undefined : { definition: found.item, owner: found.owner };
    },
    list() {
      const active = run === null ? undefined : activated.get(kernel)?.get(run);

      return registry.entries().flatMap(({ item, owner }) => {
        const parameters = converted(item.parameters, "input");
        const output = item.output === undefined ? null : converted(item.output, "output");

        if (parameters === undefined || output === undefined) return [];
        const exposure = item.exposure ?? "model";

        return [
          {
            name: item.name,
            owner,
            namespace: item.namespace ?? null,
            description: item.description,
            parameters,
            output,
            exposure:
              exposure === "deferred" && active?.has(item.name) === true ? "model" : exposure,
          },
        ];
      });
    },
    async activate(names) {
      if (run === null) return;
      const runs = activated.get(kernel) ?? new Map<RunId, Set<string>>();
      activated.set(kernel, runs);
      runs.set(run, new Set([...(runs.get(run) ?? []), ...names]));
    },
  };
}

/** Forgets the deferred tools a run activated: what `endRun` calls (§35f). */
export function dropActivations(kernel: Kernel, run: RunId): void {
  activated.get(kernel)?.delete(run);
}

/** Returns a schema's JSON Schema in one direction (`input` for what a caller sends: tool parameters, command arguments; `output` for what is shown: tool output, settings, part state), computed once per schema object and cached. Throws what the schema's `jsonSchema` throws, or `SdkError("invalid")` when the result is not a JSON object; the runtime calls it at load, so a throw is a load-time issue and never a request-time failure. */
export function jsonSchemaOf(schema: Schema<unknown>, direction: "input" | "output"): JsonSchema {
  const cached = schemas.get(schema) ?? {};
  const known = cached[direction];

  if (known !== undefined) return known;
  const result = schema["~standard"].jsonSchema[direction]({ target: "draft-2020-12" });

  if (!isJson(result) || !isJsonObject(result))
    throw new SdkError("invalid", `The schema's ${direction} JSON Schema is not a JSON object.`);

  schemas.set(
    schema,
    direction === "input" ? { ...cached, input: result } : { ...cached, output: result },
  );

  return result;
}

/** Returns a schema's JSON Schema, or undefined when it has none: what a listing shows, leaving the item out. */
function converted(schema: Schema<unknown>, direction: "input" | "output"): JsonSchema | undefined {
  try {
    return jsonSchemaOf(schema, direction);
  } catch {
    return undefined;
  }
}
