import { Type } from "typebox";
import type { TCyclic, TProperties, TSchema } from "typebox";
import { Guard } from "typebox/guard";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

const JSON_DEFINITION = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Type.Ref("Json")),
  Type.Record(Type.String(), Type.Ref("Json")),
]);

export const JsonType = Type.Unsafe<Json>(Type.Ref("Json"));

export const JsonObjectType = Type.Record(Type.String(), JsonType);

export type JsonSchema = Decoded<typeof JsonObjectType>;

export function cyclicWithJson<Definitions extends TProperties, Ref extends string>(
  definitions: Definitions,
  ref: Ref,
): TCyclic<{ Json: typeof JSON_DEFINITION } & Definitions, Ref> {
  return Type.Cyclic({ Json: JSON_DEFINITION, ...definitions }, ref);
}

export function withJson<T extends TSchema>(
  schema: T,
): TCyclic<{ Json: typeof JSON_DEFINITION } & { Root: T }, "Root"> {
  return cyclicWithJson({ Root: schema }, "Root");
}

export const JsonValueSchema: Schema<Json> = standard(withJson(JsonType));

export const JsonObjectSchema: Schema<JsonSchema> = standard(withJson(JsonObjectType));

/** Walked by hand: under a renderer's CSP a cyclic TypeBox check runs interpreted, tens of milliseconds over a long chat's view frame. */
// oxlint-disable-next-line nyte-code/no-is-helper-names -- the public guard every package narrows untyped input with
export function isJson(value: unknown): value is Json {
  if (Guard.IsArray(value)) return value.every(isJson);

  if (Guard.IsObject(value)) return Object.values(value).every(isJson);

  return (
    Guard.IsNull(value) || Guard.IsString(value) || Guard.IsBoolean(value) || Guard.IsNumber(value)
  );
}

// oxlint-disable-next-line nyte-code/no-is-helper-names -- the public guard every package narrows a JSON value to an object with
export function isJsonObject(value: Json | undefined): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
