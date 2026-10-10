import { Type, Unsafe } from "typebox";
import type { Static, TProperties, TSchema, TUnsafe } from "typebox";

type Proof<S extends TSchema, T> = [Static<S>] extends [T]
  ? [T] extends [Static<S>]
    ? S
    : never
  : never;

/** A schema for `T` that compiles only while it describes exactly `T`. */
export const typed =
  <T>() =>
  <S extends TSchema>(schema: Proof<S, T>): TUnsafe<T> =>
    Unsafe<T>(schema);

export const object = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
