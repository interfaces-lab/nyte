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

/** Names the rows answered once with JSON: queries, commands and receipts. */
export type CallName = {
  [N in OperationName]: Declarations[N]["kind"] extends "query" | "command" | "receipt" ? N : never;
}[OperationName];

/** Names the stream rows whose frames are bytes, answered as a raw octet stream. */
export type ByteName = {
  [N in OperationName]: Declarations[N]["kind"] extends "stream"
    ? OperationOutput<N> extends Uint8Array
      ? N
      : never
    : never;
}[OperationName];

/** Names the rows answered with JSON frames over server-sent events: every watch and the JSON streams. */
export type FrameName = Exclude<
  {
    [N in OperationName]: Declarations[N]["kind"] extends "watch" | "stream" ? N : never;
  }[OperationName],
  ByteName | "job.output"
>;
