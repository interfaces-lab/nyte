import type { ByteReader } from "@nyte-ai/schema";
import type { Connection, Host, Kernel } from "@nyte-ai/core";
import type {
  Declarations,
  OperationInput,
  OperationName,
  OperationOutput,
} from "./declarations.ts";

/** Returns the server side of the table for one connection: each row takes its decoded input and the request's body and abort signal, and answers its output, a stream of frames for a `watch` or `stream` row, or a byte reader for a row whose frames are bytes. */
export type Binding = {
  readonly [N in OperationName]: (
    input: OperationInput<N>,
    request: { readonly body: ReadableStream<Uint8Array> | null; readonly signal: AbortSignal },
  ) => Declarations[N]["kind"] extends "watch" | "stream"
    ? OperationOutput<N> extends Uint8Array
      ? Promise<ByteReader>
      : AsyncIterable<OperationOutput<N>>
    : Promise<OperationOutput<N>>;
};

/** Returns each row bound to the handle call it names on a connection: ids bind handles, handles returned become ids, `Set`s and `Map`s become their wire forms; `head.watch` streams the session's events from the kernel after `Last-Event-ID`, `parts.create` resolves the kind through the kernel's part definitions, and `plugins.*` and `principals.*` go to `host` (absent, `unavailable`). */
export function bindConnection(
  connection: Connection,
  served: {
    readonly kernel: Pick<
      Kernel,
      "store" | "bus" | "activation" | "catalog" | "jobs" | "pages" | "partDefinitions"
    >;
    readonly host?: Pick<Host, "plugins" | "principals">;
  },
): Binding {
  throw new Error("not implemented");
}
