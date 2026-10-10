import { Type } from "typebox";
import type { TNull, TSchema, TUnion } from "typebox";

/** Returns a schema accepting what `schema` accepts or null. */
export function nullable<T extends TSchema>(schema: T): TUnion<[T, TNull]> {
  return Type.Union([schema, Type.Null()]);
}
