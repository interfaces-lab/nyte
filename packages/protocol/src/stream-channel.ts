import { SdkError } from "@nyte-ai/core";
import type { Json } from "@nyte-ai/schema";
import { isRecord } from "./json.ts";

export const CHANNEL_PATH = ".nyte/streams";

export const CANCEL_PATH = ".nyte/streams/cancel";

export const CHANNEL_HEADER = "X-Nyte-Channel";

export const STREAM_HEADER = "X-Nyte-Stream";

export type StreamFrame =
  | { readonly kind: "chunk"; readonly stream: string; readonly data: string }
  | { readonly kind: "end"; readonly stream: string }
  | { readonly kind: "error"; readonly stream: string; readonly error: string };

export function readStreamFrame(value: Json): StreamFrame {
  if (isRecord(value) && typeof value.stream === "string") {
    if (value.kind === "chunk" && typeof value.data === "string")
      return { kind: "chunk", stream: value.stream, data: value.data };

    if (value.kind === "end") return { kind: "end", stream: value.stream };

    if (value.kind === "error" && typeof value.error === "string")
      return { kind: "error", stream: value.stream, error: value.error };
  }

  throw new SdkError("invalid", "The host sent an invalid stream frame.");
}
