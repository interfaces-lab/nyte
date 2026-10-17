/** Types for parsed JSON, so a file's contents are typed before they are trusted. */
import type { Json } from "@nyte-ai/sdk";

export type JsonObject = { readonly [key: string]: Json };

export function toJson(value: unknown): Json {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return value;

  if (Array.isArray(value)) return value.map(toJson);

  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));

  throw new TypeError(`${typeof value} is not JSON`);
}
