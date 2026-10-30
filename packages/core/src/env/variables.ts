import { isJsonObject, standard } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Kernel } from "../contract/kernel.ts";
import type { Plugin, SecretEntry, SettingDefinition } from "../contract/plugin.ts";
import type { WorkspaceRecord } from "../contract/records.ts";
import { openText } from "../extend/plugin-api.ts";
import { kvRef } from "../store/refs.ts";
import { readKv } from "../store/session.ts";

export const VARIABLES: SettingDefinition<Readonly<Record<string, SecretEntry>>> = {
  id: "variables.entries",
  label: "Environment variables",
  schema: standard(
    Type.Record(
      Type.String({ pattern: "^(?:[^/]+/)?[A-Za-z_][A-Za-z0-9_]*$" }),
      Type.Object({ secret: Type.Boolean(), value: Type.Optional(Type.String()) }),
      { additionalProperties: false },
    ),
  ),
  default: {},
  scope: "host",
  secret: true,
};

export const variablesPlugin: Plugin<"core"> = {
  id: "variables",
  contribute: { settings: [VARIABLES] },
};

export async function resolveVariables(
  kernel: Kernel,
  workspace: WorkspaceRecord,
): Promise<Record<string, string>> {
  const stored = await readKv(kernel.store, kvRef("host", "settings", VARIABLES.id));

  if (!isJsonObject(stored)) return {};

  const prefix = `${workspace.isolation?.source ?? workspace.id}/`;
  const keys = Object.keys(stored);
  const shared = keys.filter((key) => !key.includes("/")).map((key) => [key, key] as const);

  const own = keys
    .filter((key) => key.startsWith(prefix))
    .map((key) => [key.slice(prefix.length), key] as const);

  const opened = await Promise.all(
    [...shared, ...own].map(
      async (entry) => [entry[0], await openEntry(kernel, stored[entry[1]])] as const,
    ),
  );

  return Object.fromEntries(
    opened.flatMap((entry) => (entry[1] === undefined ? [] : [[entry[0], entry[1]] as const])),
  );
}

async function openEntry(kernel: Kernel, entry: Json | undefined): Promise<string | undefined> {
  if (!isJsonObject(entry)) return undefined;

  if (entry.secret !== true) return typeof entry.value === "string" ? entry.value : undefined;

  return openText(kernel, entry).catch(() => undefined);
}
