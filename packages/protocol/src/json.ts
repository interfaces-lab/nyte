import { isJson } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";

/** Returns whether a JSON value is an object: not null, not an array. */
export function isRecord(value: Json | undefined): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses JSON text and narrows the value with `isJson`. A text that is not JSON throws `SdkError("invalid")`. */
export function parseJson(text: string): Json {
  try {
    const value: unknown = JSON.parse(text);

    if (isJson(value)) return value;
  } catch {}

  throw new SdkError("invalid", "The body is not JSON.");
}
