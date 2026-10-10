import { Type } from "typebox";
import type { TCyclic, TProperties, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { Json, JsonSchema } from "../primitives.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";

const JSON_DEFINITION = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Type.Ref("Json")),
  Type.Record(Type.String(), Type.Ref("Json")),
]);

/** Validates any JSON value by referring to the `Json` definition; it resolves only beneath a root built with `withJson`. */
export const JsonType = Type.Unsafe<Json>(Type.Ref("Json"));

/** Validates a JSON object, the shape of a `JsonSchema` document; resolves beneath `withJson`. */
export const JsonObjectType = Type.Record(Type.String(), JsonType);

/** Returns a root schema that defines `Json` and each of `definitions` once under its `$defs` and validates the one named `ref`, so a recursive record refers to itself by name and the emitted JSON Schema nests no `$id`. */
export function cyclicWithJson<Definitions extends TProperties, Ref extends string>(
  definitions: Definitions,
  ref: Ref,
): TCyclic<{ Json: typeof JSON_DEFINITION } & Definitions, Ref> {
  return Type.Cyclic({ Json: JSON_DEFINITION, ...definitions }, ref);
}

/** Returns a root schema that defines `Json` once under its `$defs`, so every `JsonType` beneath it resolves to that one entry and the emitted JSON Schema loads in a standard validator. */
export function withJson<T extends TSchema>(
  schema: T,
): TCyclic<{ Json: typeof JSON_DEFINITION } & { Root: T }, "Root"> {
  return cyclicWithJson({ Root: schema }, "Root");
}

/** Validates any JSON value. */
export const JsonValueSchema: Schema<Json> = standard(withJson(JsonType));

/** Validates a JSON object, such as a `JsonSchema` document. */
export const JsonObjectSchema: Schema<JsonSchema> = standard(withJson(JsonObjectType));

const json = Compile(withJson(JsonType));

/** Returns whether a value is JSON: what a part's state and a stored record must be. */
export function isJson(value: unknown): value is Json {
  return json.Check(value);
}
