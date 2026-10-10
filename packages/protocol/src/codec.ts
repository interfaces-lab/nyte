import type { Json } from "@nyte-ai/schema";
import type { OperationInput, OperationName, OperationOutput } from "./declarations.ts";

/** Decodes an operation's input strictly: a value failing the row's input schema, or carrying a field the schema does not name, throws `SdkError("invalid")` with its issues. */
export function decodeInput<N extends OperationName>(name: N, value: unknown): OperationInput<N> {
  throw new Error("not implemented");
}

/** Encodes an operation's input as the JSON the wire carries. */
export function encodeInput<N extends OperationName>(name: N, input: OperationInput<N>): Json {
  throw new Error("not implemented");
}

/** Encodes an operation's output, or one frame of it, as the JSON the wire carries; fields its schema does not name are stripped. */
export function encodeOutput<N extends OperationName>(name: N, value: OperationOutput<N>): Json {
  throw new Error("not implemented");
}

/** Decodes an operation's output, or one frame of it, leniently: unknown fields are ignored and array records of an unknown kind skipped; a value that still fails throws `SdkError("invalid")`, which a stream reader skips. */
export function decodeOutput<N extends OperationName>(name: N, value: unknown): OperationOutput<N> {
  throw new Error("not implemented");
}
