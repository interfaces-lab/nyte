import type { ByteReader, Json, RequestOptions } from "@nyte-ai/schema";
import type { OperationName } from "./declarations.ts";

/** Describes where a transport sends requests, the headers each carries (credentials, read again per request), and the `fetch` it uses. */
export type TransportOptions = {
  readonly url: string;
  headers(): Promise<Readonly<Record<string, string>>>;
  readonly fetch?: typeof fetch;
};

/** Returns the low-level client: one primitive per wire shape, JSON in and out, every error answer rethrown as the `SdkError` it encodes. */
export type Transport = {
  invoke(name: OperationName, input: Json, options?: RequestOptions): Promise<Json>;
  stream(name: OperationName, input: Json): AsyncIterable<Uint8Array | Json>;
  bytes(name: OperationName, input: Json): Promise<ByteReader>;
  watch(
    name: OperationName,
    input: Json,
    lastEventId?: string,
  ): AsyncIterable<{ readonly id: string | null; readonly data: Json }>;
  upload(
    name: OperationName,
    input: Json,
    body: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<Json>;
};

/** Returns a transport over `fetch` and `ReadableStream`, with no `EventSource`, so headers reach every request and it runs in browsers and React Native. */
export function createTransport(options: TransportOptions): Transport {
  throw new Error("not implemented");
}
