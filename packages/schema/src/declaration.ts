import type { Schema } from "./schema.ts";

/**
 * Names the authority a served operation needs.
 *
 * **Details**
 *
 * Authority is three words. Every declaration names the authority it needs;
 * `authorize` names what a principal has; the listener answers denied for the
 * rest, and the client sees Capability denied where a namespace is gated.
 *
 * - `participant`: sessions, parts, watches.
 * - `owner`: workspaces, providers, settings, git writes.
 * - `maintenance`: `plugins.*` and `principals.*`.
 *
 * `inspect`, `prune` and `execution` are in-process only and have no
 * authority. A token principal has participant + owner.
 *
 * @category host
 * @since 0.1.0
 */
export type Authority = "participant" | "owner" | "maintenance";

/**
 * Describes one served operation: its schemas, kind, authority, scope and
 * recovery.
 *
 * **Details**
 *
 * One table is the source of every generated artifact: the client Connection
 * types, the listener's route table, codecs, the catalog a non-TS client
 * reads, and authority gating. There is no second schema for the wire: input
 * and output schemas are the wire records; handles are bound on the client
 * from returned ids.
 *
 * **Example** (Declaring a session command)
 *
 * ```ts
 * declare const SendInput: Schema<{ readonly content: UserContent; readonly options: SendOptions }>;
 * declare const ReceiptIdSchema: Schema<ReceiptId>;
 *
 * const send = {
 *   input: SendInput,
 *   output: ReceiptIdSchema,
 *   kind: "receipt",
 *   authority: "participant",
 *   scope: "session",
 *   recovery: "replay",
 * } satisfies Declaration<{ readonly content: UserContent; readonly options: SendOptions }, ReceiptId>;
 * ```
 *
 * @see {@link declarations}
 * @category host
 * @since 0.1.0
 */
export type Declaration<Input, Output> = {
  /** The wire record the call takes. */
  readonly input: Schema<Input>;
  /** The wire record the call returns. */
  readonly output: Schema<Output>;
  /**
   * `query` reads once; `watch` yields coalesced views, latest wins;
   * `command` returns its outcome; `receipt` returns a ReceiptId and the
   * outcome is a later query; `stream` yields every frame in order (bytes,
   * scan, search, patches). A `watch` or `stream` that fails after its first
   * frame ends with an error frame carrying the encoded `SdkError` (an
   * `event: error` server-sent event, or a `0x01 { kind: "error", error }`
   * control frame on a framed byte stream), which the client rethrows.
   */
  readonly kind: "query" | "watch" | "command" | "receipt" | "stream";
  /** What the calling principal must hold. */
  readonly authority: Authority;
  /** What the call is addressed to. */
  readonly scope: "host" | "session" | "workspace";
  /** Gated per environment or principal; absent = always. */
  readonly capability?: "files" | "git" | "browser";
  /** Commands only: same id + same digest replays the receipt; volatile actions (pty write, page click) never. */
  readonly recovery?: "replay" | "never";
}
