import type { Infer, Json, OPERATIONS } from "@nyte-ai/schema";

type Frozen<T> = [Json] extends [T]
  ? T
  : T extends string | number | boolean | null | undefined | Uint8Array
    ? T
    : T extends readonly (infer E)[]
      ? readonly Frozen<E>[]
      : { readonly [K in keyof T]: Frozen<T[K]> };

/** Returns the operations table's type: each row's literal kind, authority and scope, and its schemas. */
export type Declarations = typeof OPERATIONS;

/** Names one served operation: a key of the table. */
export type OperationName = keyof Declarations;

/** Returns one operation's decoded input, as its schema types it, read-only. */
export type OperationInput<N extends OperationName> = Frozen<Infer<Declarations[N]["input"]>>;

/** Returns one operation's decoded output, as its schema types it, read-only: its value, or one frame of a `watch` or `stream` row. */
export type OperationOutput<N extends OperationName> = Frozen<Infer<Declarations[N]["output"]>>;
