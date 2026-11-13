import { Type } from "typebox";
import { compile, isJsonObject, SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";

/** Types a value as JSON without looking at it, for a value known to be JSON already: what the codec walked to every leaf, or what `JSON.parse` returns once its numbers are known to be finite. */
export const unchecked = compile(Type.Unsafe<Json>({}));

export function parseJson(text: string): Json {
  const value = readJson(text);

  if (value === undefined) throw new SdkError("invalid", "The body is not JSON.");

  return value;
}

/** `JSON.parse` without a reviver returns only null, booleans, strings, finite numbers, arrays and plain objects, except that it reads a number too large for a double as an infinity; so only the numbers are checked. */
export function readJson(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);

    return unchecked.Check(value) && finite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function finite(value: Json): boolean {
  if (typeof value === "number") return Number.isFinite(value);

  if (typeof value !== "object" || value === null) return true;

  if (isJsonObject(value)) {
    for (const key in value) if (!finite(value[key] ?? null)) return false;

    return true;
  }

  for (const item of value) if (!finite(item)) return false;

  return true;
}
