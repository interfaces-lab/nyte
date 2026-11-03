import { asId, isJsonObject, SdkError, SessionCatalogViewSchema } from "@nyte-ai/schema";
import type { CatalogId, Json, SessionCatalogView } from "@nyte-ai/schema";
import type { StoreConnection } from "../contract/store.ts";
import { textDigest } from "../util/content.ts";
import { byCodePoint } from "../util/text.ts";
import { decodeObject } from "./log.ts";

export async function encodeCatalog(
  catalog: SessionCatalogView,
): Promise<{ readonly id: CatalogId; readonly body: string }> {
  const body = JSON.stringify(catalog, sortKeys);

  return { id: asId<"catalog">((await textDigest(body)).slice(0, 16)), body };
}

export async function readCatalog(
  store: StoreConnection,
  id: CatalogId,
): Promise<SessionCatalogView | null> {
  const body = await store.catalogs.get(id);

  if (body === null) return null;
  const result = SessionCatalogViewSchema["~standard"].validate(decodeObject(body));

  if (result instanceof Promise || result.issues !== undefined)
    throw new SdkError("internal", `The catalog ${id} is malformed.`);

  return result.value;
}

function sortKeys(_key: string, value: Json | undefined): Json | undefined {
  return isJsonObject(value)
    ? Object.fromEntries(
        Object.entries(value).toSorted(([left], [right]) => byCodePoint(left, right)),
      )
    : value;
}
