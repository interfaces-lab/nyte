import { isJson } from "@nyte-ai/schema";
import type { SessionId, SettingInfo } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { resolveSetting } from "../contract/plugin.ts";
import type { ResolvedSetting, SettingDefinition } from "../contract/plugin.ts";
import { readSetting, readSettingLayers } from "../store/setting-layers.ts";
import { convertJsonSchema } from "../util/json-schema.ts";

interface Defined {
  readonly definition: ResolvedSetting;
  readonly owner: string;
}

export async function settingInfos(
  kernel: Kernel,
  session: SessionId | null,
): Promise<readonly SettingInfo[]> {
  const runtime = session === null ? null : kernel.plugins.runtimes().get(session);

  if (runtime === undefined) return [];

  return describeSettings(
    kernel,
    runtime === null
      ? await shownOnHost(kernel, hostDefinitions(kernel))
      : runtime.registries.settings
          .entries()
          .map((entry) => ({ definition: resolveSetting(entry.item), owner: entry.owner })),
    session,
  );
}

export async function describeSettings(
  kernel: Kernel,
  defined: readonly Defined[],
  session: SessionId | null,
): Promise<readonly SettingInfo[]> {
  const infos = await Promise.all(
    defined.map(async ({ definition, owner }): Promise<SettingInfo | null> => {
      let schema: SettingInfo["schema"];

      try {
        schema = convertJsonSchema(definition.schema, "output");
      } catch {
        return null;
      }

      const [layer] = await readSettingLayers(kernel.store, definition, session);

      return {
        id: definition.id,
        owner,
        scope: definition.scope,
        title: definition.title,
        description: definition.description,
        placeholder: definition.placeholder,
        page: definition.page,
        secret: definition.secret,
        mode: definition.mode,
        schema,
        choices:
          definition.choices?.flatMap((choice) =>
            isJson(choice.value)
              ? [{ value: choice.value, title: choice.title, note: choice.note }]
              : [],
          ) ?? null,
        value: layer?.value ?? (isJson(definition.default) ? definition.default : null),
        from: layer?.from ?? "default",
      };
    }),
  );

  return infos.flatMap((info) => (info === null ? [] : [info]));
}

async function shownOnHost(
  kernel: Kernel,
  defined: readonly Defined[],
): Promise<readonly Defined[]> {
  if (defined.every((entry) => entry.definition.when === undefined)) return defined;

  const chat = {
    parent: null,
    settings: await readSettingValues(
      kernel,
      null,
      defined.map((entry) => entry.definition),
    ),
    searchProviders: [],
  };

  return defined.filter((entry) => {
    try {
      return entry.definition.when === undefined || entry.definition.when(chat);
    } catch {
      return false;
    }
  });
}

/** Each setting's current value in a session, by id, as a `when` reads it; with no session, the host's values. */
export async function readSettingValues(
  kernel: Kernel,
  session: SessionId | null,
  settings: readonly SettingDefinition[],
): Promise<Readonly<Record<string, unknown>>> {
  return Object.fromEntries(
    await Promise.all(
      settings.map(async (entry) => {
        const definition = resolveSetting(entry);

        return [definition.id, await readSetting(kernel.store, definition, session)] as const;
      }),
    ),
  );
}

export function findSettingDefinition(kernel: Kernel, id: string): Defined | undefined {
  return (
    staticDefinitions(kernel).find(
      (entry) => entry.definition.scope === "host" && entry.definition.id === id,
    ) ??
    [...kernel.plugins.runtimes().values()]
      .flatMap((runtime) => runtime.registries.settings.entries())
      .map((entry) => ({ definition: resolveSetting(entry.item), owner: entry.owner }))
      .find((entry) => entry.definition.id === id)
  );
}

function hostDefinitions(kernel: Kernel): readonly Defined[] {
  const seen = new Set<string>();

  return [
    ...staticDefinitions(kernel).filter((entry) => entry.definition.scope === "host"),
    ...[...kernel.plugins.runtimes().values()].flatMap((runtime) =>
      runtime.registries.settings
        .entries()
        .map((entry) => ({ definition: resolveSetting(entry.item), owner: entry.owner }))
        .filter((entry) => entry.definition.scope === "host"),
    ),
  ].filter((entry) => {
    if (seen.has(entry.definition.id)) return false;
    seen.add(entry.definition.id);

    return true;
  });
}

function staticDefinitions(kernel: Kernel): readonly Defined[] {
  return [...kernel.plugins.builtins, ...kernel.plugins.host].flatMap((plugin) =>
    (plugin.contribute?.settings ?? []).map((entry) => ({
      definition: resolveSetting(entry),
      owner: plugin.id,
    })),
  );
}
