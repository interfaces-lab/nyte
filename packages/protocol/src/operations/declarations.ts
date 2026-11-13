import type { Infer, Json, OPERATIONS } from "@nyte-ai/schema";

type Frozen<T> = [Json] extends [T]
  ? T
  : T extends string | number | boolean | null | undefined | Uint8Array
    ? T
    : T extends readonly (infer E)[]
      ? readonly Frozen<E>[]
      : { readonly [K in keyof T]: Frozen<T[K]> };

export type Declarations = typeof OPERATIONS;

export type OperationName = keyof Declarations;

export type OperationInput<N extends OperationName> = Frozen<Infer<Declarations[N]["input"]>>;

export type OperationOutput<N extends OperationName> = Frozen<Infer<Declarations[N]["output"]>>;

export type CallName = {
  [N in OperationName]: Declarations[N]["kind"] extends "query" | "command" | "receipt" ? N : never;
}[OperationName];

export type ByteName = {
  [N in OperationName]: Declarations[N]["kind"] extends "stream"
    ? OperationOutput<N> extends Uint8Array
      ? N
      : never
    : never;
}[OperationName];

export type FrameName = Exclude<
  {
    [N in OperationName]: Declarations[N]["kind"] extends "watch" | "stream" ? N : never;
  }[OperationName],
  ByteName | "job.output"
>;
