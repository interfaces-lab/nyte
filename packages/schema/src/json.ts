import { Type } from "typebox";
import type { TCyclic, TProperties, TSchema } from "typebox";
import { compile, standard } from "./schema.ts";
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

const json = compile(withJson(JsonType));

// oxlint-disable-next-line nyte-code/no-is-helper-names -- the public guard every package narrows untyped input with
export function isJson(value: unknown): value is Json {
  return json.Check(value);
}
