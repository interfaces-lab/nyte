import { isJson, SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";

export function parseJson(text: string): Json {
  try {
    const value: unknown = JSON.parse(text);

    if (isJson(value)) return value;
  } catch {}

  throw new SdkError("invalid", "The body is not JSON.");
}
