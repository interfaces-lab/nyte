import { isJson } from "@nyte-ai/schema";
import type { SessionId, SettingInfo } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { SettingDefinition } from "../contract/plugin.ts";
import { readSettingLayers } from "../store/setting-layers.ts";
import { convertJsonSchema } from "../util/json-schema.ts";

interface Defined {
  readonly definition: SettingDefinition;
  readonly owner: string;
}

export async function settingInfos(
  kernel: Kernel,
  session: SessionId | null,
): Promise<readonly SettingInfo[]> {
  const runtime = session === null ? null : kernel.plugins.runtimes().get(session);

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

      const [layer] = await readSettingLayers(kernel.store, definition, session);

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

export function findSettingDefinition(kernel: Kernel, id: string): Defined | undefined {
  return (
    staticHostDefinitions(kernel).find((entry) => entry.definition.id === id) ??
    [...kernel.plugins.runtimes().values()]
      .flatMap((runtime) => runtime.registries.settings.entries())
      .map((entry) => ({ definition: entry.item, owner: entry.owner }))
      .find((entry) => entry.definition.id === id)
  );
}

function hostDefinitions(kernel: Kernel): readonly Defined[] {
  const seen = new Set<string>();

  return [
    ...staticHostDefinitions(kernel),
    ...[...kernel.plugins.runtimes().values()].flatMap((runtime) =>
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
  return [...kernel.plugins.builtins, ...kernel.plugins.host].flatMap((plugin) =>
    (plugin.contribute?.settings ?? []).flatMap((definition) =>
      definition.scope === "host" ? [{ definition, owner: plugin.id }] : [],
    ),
  );
}
