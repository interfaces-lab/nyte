/**
 * The helpers every schema module builds with. Inputs are strict, outputs are
 * open, and `typed<T>()` pins a schema to the interface it validates; the
 * policy is spelled out at the top of `schemas.ts`.
 */
import { Type, Unsafe } from "typebox";
import type { Static, TProperties, TSchema, TUnsafe } from "typebox";

/** `T` with every `readonly` removed, so a schema's static type (never readonly) can be compared to it. */
type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly [infer Head, ...infer Rest]
    ? [Mutable<Head>, ...Mutable<Rest>]
    : T extends readonly (infer Item)[]
      ? Mutable<Item>[]
      : T extends object
        ? { -readonly [K in keyof T]: Mutable<T[K]> }
        : T;

type Proof<S extends TSchema, T> = [Static<S>] extends [T]
  ? [Mutable<T>] extends [Static<S>]
    ? S
    : never
  : never;

/**
 * Pin a runtime schema to the interface it validates. The argument type
 * collapses to `never` when the schema admits a value that is not a `T`, or
 * refuses a value that is one (readonly aside).
 */
export const typed =
  <T>() =>
  <S extends TSchema>(schema: Proof<S, T>): TUnsafe<T> =>
    Unsafe<T>(schema);

/** An input object: every key named, no other key accepted. */
export const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

/** An output object: the named keys, extra keys tolerated. */
export const open = <P extends TProperties>(properties: P) => Type.Object(properties);

/** An operation input that may be absent altogether. */
export const optional = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Undefined()]);

export const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** An output array. The SDK hands out `readonly` arrays, so the static type says so too. */
export const list = <T extends TSchema>(item: T) => Unsafe<readonly Static<T>[]>(Type.Array(item));

/** A union of string literals whose static type keeps every member. */
export const literals = <Values extends string[]>(values: readonly [...Values]) =>
  Type.Enum(values);
