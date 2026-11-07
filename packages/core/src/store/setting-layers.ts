import { isJsonObject } from "@nyte-ai/schema";
import type { Json, SessionId } from "@nyte-ai/schema";
import type { SettingDefinition } from "../contract/plugin.ts";
import type { StoreConnection } from "../contract/store.ts";
import { check } from "../util/json-schema.ts";
import { kvRef } from "./refs.ts";
import { MAIN, readKv, readSession } from "./session.ts";

interface Layer {
  readonly value: Json;
  readonly from: "host" | "session";
}

export async function readSettingLayers(
  store: StoreConnection,
  definition: Pick<SettingDefinition, "id" | "scope" | "secret">,
  session: SessionId | null,
): Promise<readonly Layer[]> {
  const [own, stored] = await Promise.all([
    definition.scope === "session" && session !== null
      ? sessionValue(store, session, definition.id)
      : undefined,
    readKv(store, kvRef("host", "settings", definition.id)),
  ]);

  const host = stored !== undefined && definition.secret ? redactSecretEntries(stored) : stored;

  return [
    ...(own === undefined ? [] : [{ value: own, from: "session" } as const]),
    ...(host === undefined ? [] : [{ value: host, from: "host" } as const]),
  ];
}

export async function readSetting<T>(
  store: StoreConnection,
  definition: SettingDefinition<T>,
  session: SessionId | null,
): Promise<T> {
  for (const layer of await readSettingLayers(store, definition, session)) {
    const checked = await check(definition.schema, layer.value);

    if (checked.kind === "valid") return checked.value;
  }

  return definition.default;
}

async function sessionValue(
  store: StoreConnection,
  session: SessionId,
  id: string,
): Promise<Json | undefined> {
  const found = await readSession(store, session);
  const settings = found?.record.heads.find((head) => head.name === MAIN)?.selected?.settings;

  return settings !== undefined && Object.hasOwn(settings, id) ? settings[id] : undefined;
}

function redactSecretEntries(stored: Json): Json {
  if (!isJsonObject(stored)) return stored;

  return Object.fromEntries(
    Object.entries(stored).map((entry) => [
      entry[0],
      isJsonObject(entry[1]) && entry[1].secret === true ? { secret: true } : entry[1],
    ]),
  );
}
