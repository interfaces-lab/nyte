import { asId, isJsonObject } from "@nyte-ai/schema";
import type { CatalogId, Json, SessionCatalogView } from "@nyte-ai/schema";
import { textDigest } from "../util/content.ts";
import { byCodePoint } from "../util/text.ts";

export async function encodeCatalog(
  catalog: SessionCatalogView,
): Promise<{ readonly id: CatalogId; readonly body: string }> {
  const body = JSON.stringify(catalog, sortKeys);

  return { id: asId<"catalog">((await textDigest(body)).slice(0, 16)), body };
}

function sortKeys(_key: string, value: Json | undefined): Json | undefined {
  return isJsonObject(value)
    ? Object.fromEntries(
        Object.entries(value).toSorted(([left], [right]) => byCodePoint(left, right)),
      )
    : value;
}
