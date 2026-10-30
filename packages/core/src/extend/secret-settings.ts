import { isJsonObject, SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { sealText } from "./plugin-api.ts";

/** A `secret` setting's stored map as anyone reads it: every secret entry without its value. */
export function redactSecretEntries(stored: Json): Json {
  if (!isJsonObject(stored)) return stored;

  return Object.fromEntries(
    Object.entries(stored).map((entry) => [
      entry[0],
      isJsonObject(entry[1]) && entry[1].secret === true ? { secret: true } : entry[1],
    ]),
  );
}

/**
 * Turns a written `secret` setting map into the stored one: a secret value is sealed, and a
 * secret entry written without a value keeps the sealed one from `stored`. A key the write
 * leaves out is gone.
 */
export async function sealSecretEntries(
  kernel: Kernel,
  written: Json,
  stored: Json | undefined,
): Promise<Json> {
  if (!isJsonObject(written)) return written;

  const kept = isJsonObject(stored) ? stored : {};

  const entries = await Promise.all(
    Object.entries(written).map(async (entry): Promise<[string, Json]> => {
      const key = entry[0];
      const value = entry[1];

      if (!isJsonObject(value) || value.secret !== true) return [key, value];

      if (typeof value.value === "string")
        return [key, { secret: true, ...(await sealText(kernel, value.value)) }];

      const previous = kept[key];

      if (isJsonObject(previous) && previous.secret === true && "ciphertext" in previous)
        return [key, previous];

      throw new SdkError("invalid", `${key} is secret but has no value to keep. Enter one.`);
    }),
  );

  return Object.fromEntries(entries);
}
