import type { Disposer, Json, SessionId, SettingInfo } from "@nyte-ai/schema";
import { jsonSchemaOf, publishCatalog } from "./catalog.ts";
import type { SettingsApi } from "./connection.ts";
import { SdkError } from "./error.ts";
import { headHandle } from "./head.ts";
import { check, isJson } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import type { Setting, SettingDefinition } from "./plugin.ts";
import { pluginRuntimes } from "./plugin-runtime.ts";
import { readKv } from "./plugin-storage.ts";
import { CORE_CONTEXT } from "./principals.ts";
import { kvRef } from "./refs.ts";
import { MAIN, commit, put, readSession } from "./session-state.ts";

/** Names the layer a setting change landed in: the host value, or one session's. */
type SettingScope =
  | { readonly kind: "host" }
  | { readonly kind: "session"; readonly session: SessionId };

/** Carries setting changes in this process: `apply` and `Setting.set` announce them; `Setting.watch` listens. One per kernel, created on first use. */
interface SettingsBus {
  /** Calls every listener with the setting and the layer it changed in. */
  changed(id: string, scope: SettingScope): void;
  /** Calls the listener on every change; the disposer stops it. */
  subscribe(listener: (id: string, scope: SettingScope) => void): Disposer;
}

/** Returns one setting's definition with the plugin that contributed it. */
interface Defined {
  readonly definition: SettingDefinition;
  readonly owner: string;
}

/** Returns a value stored for a setting with the layer it came from. */
interface Layer {
  readonly value: Json;
  readonly from: "host" | "session";
}

const buses = new WeakMap<Kernel, SettingsBus>();

/** Returns the host's settings api. `apply(id, value)` finds the definition (§35c: the static host-scope `contribute.settings` of `kernel.builtins` and `kernel.hostPlugins` first, then what a live session's plugins contributed; `unknown` when none has the id), validates `value` against its schema (`invalid` with the issues), stores it at `kvRef("host", "settings", id)` as a `kv` envelope, announces it on the settings bus, and republishes every live session's catalog and `HostView.settings`. A session-scope setting's host value is what its sessions inherit until they configure their own. What `kernel.settings` holds. */
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

/** Returns a plugin's handle on its own setting, what `contribute.settings.add` returns. `get` resolves the session layer (a session-scope setting's value in the session's main head configuration, `settings[id]`), else the host value, else `definition.default`, skipping a stored value the schema no longer accepts; `set` validates, then stores a host-scope value as `apply` does, or configures the session's main head with `{ settings: { [id]: value } }` and republishes its catalog, and announces it; `watch` yields the current value, then the value after each change the bus announces for this id, until `signal` aborts (the plugin's deactivation). With `session` null only the host and default layers apply. */
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

      busOf(kernel).changed(id, { kind: "session", session });
      await publishCatalog(kernel, session);
    },
    watch: () => ({
      async *[Symbol.asyncIterator]() {
        let changed = Promise.withResolvers<void>();

        const stop = busOf(kernel).subscribe((setting, scope) => {
          if (setting === id && (scope.kind === "host" || scope.session === session))
            changed.resolve();
        });

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
          stop();
          signal.removeEventListener("abort", deactivate);
        }
      },
    }),
  };
}

/** Returns every setting with its owner, JSON Schema (`jsonSchemaOf`), choices, current value and the layer that set it; a setting whose schema has no JSON Schema is left out. With a session: the settings its plugins contributed, session layer included (`SessionCatalogView.settings`). With null: the host-scope settings (§35c: the static ones of `kernel.builtins` and `kernel.hostPlugins`, then those the live sessions' plugins added), the first owner per id (`HostView.settings`). */
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

/** Republishes `HostView.settings` from `settingInfos(kernel, null)`. */
export async function publishSettings(kernel: Kernel): Promise<void> {
  kernel.host.update({ settings: await settingInfos(kernel, null) });
}

/** Stores a setting's host value, announces it, and republishes what depends on it: every live session's catalog and `HostView.settings`. */
async function storeHostValue(kernel: Kernel, id: string, value: Json): Promise<void> {
  await commit(kernel, [
    { name: kvRef("host", "settings", id), target: await put(kernel, "kv", value) },
  ]);
  busOf(kernel).changed(id, { kind: "host" });

  await Promise.all([
    ...[...kernel.runtimes().keys()].map((session) => publishCatalog(kernel, session)),
    publishSettings(kernel),
  ]);
}

/** Returns the values stored for a setting, most specific first: the session's own (for a session-scope setting with a session), then the host's. */
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

/** Returns a session's own value for a setting: its main head configuration's `settings[id]`, or undefined when it has none. */
async function sessionValue(
  kernel: Kernel,
  session: SessionId,
  id: string,
): Promise<Json | undefined> {
  const found = await readSession(kernel, session);
  const settings = found?.record.heads.find((head) => head.name === MAIN)?.selected?.settings;

  return settings !== undefined && Object.hasOwn(settings, id) ? settings[id] : undefined;
}

/** Returns a setting's definition and owner: a host plugin's static host-scope entry first (§35c), then what a live session's plugins contributed. */
function definitionOf(kernel: Kernel, id: string): Defined | undefined {
  return (
    staticHostDefinitions(kernel).find((entry) => entry.definition.id === id) ??
    pluginRuntimes(kernel)
      .flatMap((runtime) => runtime.registries.settings.entries())
      .map((entry) => ({ definition: entry.item, owner: entry.owner }))
      .find((entry) => entry.definition.id === id)
  );
}

/** Returns the host-scope settings, first owner per id: the static ones of `kernel.builtins` and `kernel.hostPlugins`, then those the live sessions' plugins added. */
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

/** Returns the static host-scope `contribute.settings` of `kernel.builtins` then `kernel.hostPlugins` with their owners (§35c). */
function staticHostDefinitions(kernel: Kernel): readonly Defined[] {
  return [...kernel.builtins, ...kernel.hostPlugins].flatMap((plugin) =>
    (plugin.contribute?.settings ?? []).flatMap((definition) =>
      definition.scope === "host" ? [{ definition, owner: plugin.id }] : [],
    ),
  );
}

/** Returns the kernel's settings bus, created on first use. */
function busOf(kernel: Kernel): SettingsBus {
  const known = buses.get(kernel);

  if (known !== undefined) return known;
  const listeners = new Set<(id: string, scope: SettingScope) => void>();

  const bus: SettingsBus = {
    changed(id, scope) {
      for (const listener of listeners) listener(id, scope);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };

  buses.set(kernel, bus);

  return bus;
}
