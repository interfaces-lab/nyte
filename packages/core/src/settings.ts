import { isJson } from "@nyte-ai/schema";
import type { Json, SessionId, SettingInfo } from "@nyte-ai/schema";
import type { SettingsApi } from "./connection.ts";
import { SdkError } from "./error.ts";
import { configure } from "./head.ts";
import { check, convertJsonSchema } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import { readKv } from "./plugin-runtime.ts";
import type { Setting, SettingDefinition } from "./plugin.ts";
import { kvRef } from "./refs.ts";
import { publishCatalog } from "./registry.ts";
import { MAIN, commit, put, readSession } from "./session-state.ts";
import { SKILL_PATHS, WORKSPACE_TRUST } from "./resources.ts";
import { trustChanged } from "./workspaces.ts";

interface Defined {
  readonly definition: SettingDefinition;
  readonly owner: string;
}

interface Layer {
  readonly value: Json;
  readonly from: "host" | "session";
}

export function createSettingsApi(kernel: Kernel): SettingsApi {
  return {
    async apply(id, value) {
      const found = findSettingDefinition(kernel, id);

      if (found === undefined) return { kind: "unknown" };
      const checked = await check(found.definition.schema, value);

      if (checked.kind === "invalid") return { kind: "invalid", issues: checked.issues };
      await storeHostValue(kernel, id, value);

      return { kind: "applied" };
    },
  };
}

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
    for (const layer of await readSettingLayers(kernel, definition, session)) {
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

      const outcome = await configure(kernel, session, MAIN, { settings: { [id]: value } }, true);

      if (outcome.kind !== "configured")
        throw new SdkError("invalid", `Setting ${id} could not be configured: ${outcome.kind}.`, {
          issues: outcome.kind === "invalid" ? outcome.issues : [],
        });
    },
    watch: () => ({
      async *[Symbol.asyncIterator]() {
        let changed = Promise.withResolvers<void>();

        const { settings } = kernel.pluginState;

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

export async function settingInfos(
  kernel: Kernel,
  session: SessionId | null,
): Promise<readonly SettingInfo[]> {
  const runtime = session === null ? null : kernel.runtimes().get(session);

  if (runtime === undefined) return [];

  const defined =
    runtime === null
      ? hostDefinitions(kernel)
      : runtime.registries.settings
          .entries()
          .map((entry) => ({ definition: entry.item, owner: entry.owner }));

  const infos = await Promise.all(
    defined.map(async ({ definition, owner }): Promise<SettingInfo | null> => {
      let schema: SettingInfo["schema"];

      try {
        schema = convertJsonSchema(definition.schema, "output");
      } catch {
        return null;
      }

      const [layer] = await readSettingLayers(kernel, definition, session);

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

export async function publishSettings(kernel: Kernel): Promise<void> {
  kernel.host.update({ settings: await settingInfos(kernel, null) });
}

async function storeHostValue(kernel: Kernel, id: string, value: Json): Promise<void> {
  await commit(kernel, [
    { name: kvRef("host", "settings", id), target: await put(kernel, "kv", value) },
  ]);
  changed(kernel, id, null);

  if (id === WORKSPACE_TRUST) void trustChanged(kernel).catch(() => undefined);

  if (id === SKILL_PATHS) {
    kernel.workspaceState.scans.clear();

    for (const session of kernel.runtimes().keys())
      void kernel.reloadPlugins(session).catch(() => undefined);
  }

  await Promise.all([
    ...[...kernel.runtimes().keys()].map((session) => publishCatalog(kernel, session)),
    publishSettings(kernel),
  ]);
}

async function readSettingLayers(
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

async function sessionValue(
  kernel: Kernel,
  session: SessionId,
  id: string,
): Promise<Json | undefined> {
  const found = await readSession(kernel, session);
  const settings = found?.record.heads.find((head) => head.name === MAIN)?.selected?.settings;

  return settings !== undefined && Object.hasOwn(settings, id) ? settings[id] : undefined;
}

function findSettingDefinition(kernel: Kernel, id: string): Defined | undefined {
  return (
    staticHostDefinitions(kernel).find((entry) => entry.definition.id === id) ??
    [...kernel.runtimes().values()]
      .flatMap((runtime) => runtime.registries.settings.entries())
      .map((entry) => ({ definition: entry.item, owner: entry.owner }))
      .find((entry) => entry.definition.id === id)
  );
}

function hostDefinitions(kernel: Kernel): readonly Defined[] {
  const seen = new Set<string>();

  return [
    ...staticHostDefinitions(kernel),
    ...[...kernel.runtimes().values()].flatMap((runtime) =>
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

function staticHostDefinitions(kernel: Kernel): readonly Defined[] {
  return [...kernel.builtins, ...kernel.hostPlugins].flatMap((plugin) =>
    (plugin.contribute?.settings ?? []).flatMap((definition) =>
      definition.scope === "host" ? [{ definition, owner: plugin.id }] : [],
    ),
  );
}

export async function settingsConfigured(
  kernel: Kernel,
  session: SessionId,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) changed(kernel, id, session);
  await publishCatalog(kernel, session);
}

function changed(kernel: Kernel, id: string, session: SessionId | null): void {
  for (const listener of kernel.pluginState.settings) listener(id, session);
}
