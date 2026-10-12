import { isJson } from "@nyte-ai/schema";
import type { Json, SessionId, SettingInfo } from "@nyte-ai/schema";
import type { SettingsApi } from "./connection.ts";
import { SdkError } from "./error.ts";
import { headHandle } from "./head.ts";
import { check } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import { pluginRuntimes, pluginState, readKv } from "./plugin-runtime.ts";
import type { Setting, SettingDefinition } from "./plugin.ts";
import { CORE_CONTEXT } from "./principals.ts";
import { kvRef } from "./refs.ts";
import { jsonSchemaOf, publishCatalog } from "./registry.ts";
import { MAIN, commit, put, readSession } from "./session-state.ts";

interface Defined {
  readonly definition: SettingDefinition;
  readonly owner: string;
}

interface Layer {
  readonly value: Json;
  readonly from: "host" | "session";
}

/** Returns the host's settings api: `apply` finds the definition (§35c), validates the value and stores it at `kvRef("host", "settings", id)`, then republishes every live session's catalog and `HostView.settings`. A session-scope setting's host value is what its sessions inherit until they configure their own. */
export function createSettingsApi(kernel: Kernel): SettingsApi {
  return {
    async apply(id, value) {
      const found = definitionOf(kernel, id);

      if (found === undefined) return { kind: "unknown" };
      const checked = await check(found.definition.schema, value);

      if (checked.kind === "invalid") return { kind: "invalid", issues: checked.issues };
      await storeHostValue(kernel, id, value);

      return { kind: "applied" };
    },
  };
}

/** Returns a plugin's handle on its own setting. `get` resolves the session layer (the main head configuration's `settings[id]`), else the host value, else the default, skipping a stored value the schema no longer accepts; a session-scope `set` configures the main head. `watch` yields the value, then each change, until `signal` aborts. */
export function settingHandle<T>(
  kernel: Kernel,
  definition: SettingDefinition<T>,
  input: {
    readonly owner: string;
    readonly session: SessionId | null;
    readonly signal: AbortSignal;
  },
): Setting<T> {
  const { session, signal } = input;
  const { id } = definition;

  const get = async (): Promise<T> => {
    for (const layer of await layersOf(kernel, definition, session)) {
      const checked = await check(definition.schema, layer.value);

      if (checked.kind === "valid") return checked.value;
    }

    return definition.default;
  };

  return {
    get,
    async set(value) {
      if (!isJson(value)) throw new SdkError("invalid", `Setting ${id} takes a JSON value.`);
      const checked = await check(definition.schema, value);

      if (checked.kind === "invalid")
        throw new SdkError("invalid", `Setting ${id} rejects this value.`, {
          issues: checked.issues,
        });

      if (definition.scope === "host" || session === null) {
        await storeHostValue(kernel, id, value);

        return;
      }

      const outcome = await headHandle(kernel, CORE_CONTEXT, session, MAIN).configure({
        settings: { [id]: value },
      });

      if (outcome.kind !== "configured")
        throw new SdkError("invalid", `Setting ${id} could not be configured: ${outcome.kind}.`, {
          issues: outcome.kind === "invalid" ? outcome.issues : [],
        });

      changed(kernel, id, session);
      await publishCatalog(kernel, session);
    },
    watch: () => ({
      async *[Symbol.asyncIterator]() {
        let changed = Promise.withResolvers<void>();

        const { settings } = pluginState(kernel);

        const listener = (setting: string, scope: SessionId | null): void => {
          if (setting === id && (scope === null || scope === session)) changed.resolve();
        };

        settings.add(listener);

        const deactivated = Promise.withResolvers<void>();
        const deactivate = (): void => deactivated.resolve();
        signal.addEventListener("abort", deactivate, { once: true });

        try {
          if (signal.aborted) return;

          yield await get();

          for (;;) {
            await Promise.race([changed.promise, deactivated.promise]);

            if (signal.aborted) return;
            changed = Promise.withResolvers<void>();

            yield await get();
          }
        } finally {
          settings.delete(listener);
          signal.removeEventListener("abort", deactivate);
        }
      },
    }),
  };
}

/** Returns every setting with its owner, JSON Schema, choices, value and the layer that set it, leaving out one without JSON Schema. With a session: its plugins' settings (`SessionCatalogView.settings`); with null: the host-scope settings, first owner per id (`HostView.settings`, §35c). */
export async function settingInfos(
  kernel: Kernel,
  session: SessionId | null,
): Promise<readonly SettingInfo[]> {
  const defined =
    session === null
      ? hostDefinitions(kernel)
      : kernel
          .pluginsFor(session)
          .registries.settings.entries()
          .map((entry) => ({ definition: entry.item, owner: entry.owner }));

  const infos = await Promise.all(
    defined.map(async ({ definition, owner }): Promise<SettingInfo | null> => {
      let schema: SettingInfo["schema"];

      try {
        schema = jsonSchemaOf(definition.schema, "output");
      } catch {
        return null;
      }

      const [layer] = await layersOf(kernel, definition, session);

      return {
        id: definition.id,
        owner,
        scope: definition.scope,
        label: definition.label,
        schema,
        choices:
          definition.choices?.flatMap((choice) =>
            isJson(choice.value)
              ? [{ value: choice.value, label: choice.label, badge: choice.badge }]
              : [],
          ) ?? null,
        value: layer?.value ?? (isJson(definition.default) ? definition.default : null),
        from: layer?.from ?? "default",
      };
    }),
  );

  return infos.flatMap((info) => (info === null ? [] : [info]));
}

/** Republishes `HostView.settings`. */
export async function publishSettings(kernel: Kernel): Promise<void> {
  kernel.host.update({ settings: await settingInfos(kernel, null) });
}

/** Stores a setting's host value, announces it, and republishes every live session's catalog and `HostView.settings`. */
async function storeHostValue(kernel: Kernel, id: string, value: Json): Promise<void> {
  await commit(kernel, [
    { name: kvRef("host", "settings", id), target: await put(kernel, "kv", value) },
  ]);
  changed(kernel, id, null);

  await Promise.all([
    ...[...kernel.runtimes().keys()].map((session) => publishCatalog(kernel, session)),
    publishSettings(kernel),
  ]);
}

/** Returns the values stored for a setting, most specific first. */
async function layersOf(
  kernel: Kernel,
  definition: Pick<SettingDefinition, "id" | "scope">,
  session: SessionId | null,
): Promise<readonly Layer[]> {
  const [own, host] = await Promise.all([
    definition.scope === "session" && session !== null
      ? sessionValue(kernel, session, definition.id)
      : undefined,
    readKv(kernel, kvRef("host", "settings", definition.id)),
  ]);

  return [
    ...(own === undefined ? [] : [{ value: own, from: "session" } as const]),
    ...(host === undefined ? [] : [{ value: host, from: "host" } as const]),
  ];
}

/** Returns a session's own value for a setting from its main head configuration. */
async function sessionValue(
  kernel: Kernel,
  session: SessionId,
  id: string,
): Promise<Json | undefined> {
  const found = await readSession(kernel, session);
  const settings = found?.record.heads.find((head) => head.name === MAIN)?.selected?.settings;

  return settings !== undefined && Object.hasOwn(settings, id) ? settings[id] : undefined;
}

/** Returns a setting's definition and owner: a host plugin's static host-scope entry first (§35c), then a live session's. */
function definitionOf(kernel: Kernel, id: string): Defined | undefined {
  return (
    staticHostDefinitions(kernel).find((entry) => entry.definition.id === id) ??
    pluginRuntimes(kernel)
      .flatMap((runtime) => runtime.registries.settings.entries())
      .map((entry) => ({ definition: entry.item, owner: entry.owner }))
      .find((entry) => entry.definition.id === id)
  );
}

/** Returns the host-scope settings, first owner per id: the static ones, then the live sessions'. */
function hostDefinitions(kernel: Kernel): readonly Defined[] {
  const seen = new Set<string>();

  return [
    ...staticHostDefinitions(kernel),
    ...pluginRuntimes(kernel).flatMap((runtime) =>
      runtime.registries.settings
        .entries()
        .flatMap((entry) =>
          entry.item.scope === "host" ? [{ definition: entry.item, owner: entry.owner }] : [],
        ),
    ),
  ].filter((entry) => {
    if (seen.has(entry.definition.id)) return false;
    seen.add(entry.definition.id);

    return true;
  });
}

/** Returns the static host-scope settings of `kernel.builtins` then `kernel.hostPlugins` (§35c). */
function staticHostDefinitions(kernel: Kernel): readonly Defined[] {
  return [...kernel.builtins, ...kernel.hostPlugins].flatMap((plugin) =>
    (plugin.contribute?.settings ?? []).flatMap((definition) =>
      definition.scope === "host" ? [{ definition, owner: plugin.id }] : [],
    ),
  );
}

/** Announces a setting change to its watchers; a null session is the host layer. */
function changed(kernel: Kernel, id: string, session: SessionId | null): void {
  for (const listener of pluginState(kernel).settings) listener(id, session);
}
