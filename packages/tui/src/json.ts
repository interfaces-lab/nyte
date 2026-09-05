/** Guards over parsed JSON, so a file's contents are typed before they are trusted. */
import type { JsonValue } from "@nyte-ai/schema";

export type JsonObject = { readonly [key: string]: JsonValue };

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

/** The error `readFile` throws for a path that is not there. */
export function isMissingFile(cause: unknown): cause is { readonly code: "ENOENT" } {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}
