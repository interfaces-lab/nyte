import type { Configuration, ConfigurationPatch } from "./configuration.ts";
import type { CallId, MessageId, SessionId } from "./ids.ts";
import type { Delivery, MessageSource, UserContent } from "./messages.ts";
import type { Message as ModelMessage } from "./model/message.ts";
import type { ModelRef, Thinking, Usage } from "./models.ts";
import type { Json } from "./primitives.ts";
import type { ToolInfo } from "./sessions.ts";
import type { ToolClass } from "./tools.ts";

/**
 * Returns the `before_send` payload; modify replaces the whole value.
 *
 * @category hooks
 * @since 0.1.0
 */
export type Submission = {
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly configuration: Configuration | ConfigurationPatch | null;
  readonly replace: MessageId | null;
}

/**
 * Returns the `transform_context` payload: what the kernel assembled for
 * this request, before the system frame.
 *
 * @category hooks
 * @since 0.1.0
 */
export type ModelContext = {
  /** The rendered prompt sections. */
  readonly system: string;
  /** The conversation as the model will read it, without system messages. */
  readonly messages: readonly ModelMessage[];
}

/**
 * Returns the `transform_transcript` payload: after every
 * `transform_context`, the exact request body. The handler owns it.
 *
 * @category hooks
 * @since 0.1.0
 */
export type Transcript = {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolInfo[];
}

/**
 * Returns the `before_compaction` payload: a plugin may change what is
 * summarised, or supply the summary and skip the model.
 *
 * @category hooks
 * @since 0.1.0
 */
export type CompactionPlan = {
  readonly model: ModelRef;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly instructions: string | null;
  readonly tokensBefore: number;
  readonly summarise: readonly ModelMessage[];
  /** The retained tail. */
  readonly keep: readonly ModelMessage[];
  /** Set it and core writes the compaction part without a request; material is provider-opaque (encrypted Responses compaction). */
  readonly result: { readonly kind: "summary"; readonly text: string } | { readonly kind: "material"; readonly provider: string; readonly api: string; readonly model: string; readonly data: Json; readonly usage: Usage | null } | null;
}

/**
 * Returns the `before_request` payload, per provider request.
 *
 * @category hooks
 * @since 0.1.0
 */
export type ModelRequest = {
  readonly model: ModelRef;
  readonly thinking: Thinking;
  readonly step: "assistant" | "compaction" | "summary";
  readonly attempt: number;
  readonly options: { readonly sampling: Readonly<Record<string, Json>>; readonly headers: Readonly<Record<string, string>> };
}

/**
 * Returns the `before_tool` payload; modify replaces args and later handlers
 * see the change.
 *
 * @category hooks
 * @since 0.1.0
 */
export type ToolCall = {
  readonly call: CallId;
  readonly name: string;
  readonly args: Json;
  readonly class: ToolClass;
}

/**
 * Returns the client-side `before_submit` payload: the composer's content on
 * Enter.
 *
 * @category hooks
 * @since 0.1.0
 */
export type SubmitDraft = {
  readonly content: UserContent;
  readonly delivery: Delivery;
  readonly session: SessionId;
}

/**
 * Returns a decide hook's verdict.
 *
 * **Outcomes**
 *
 * - `continue`: no opinion; the next handler decides.
 * - `modify`: replace the value; later handlers see `value`.
 * - `reject`: short-circuit; the operation is refused with `reason`.
 * - `error`: fail the operation with `message`.
 *
 * @category hooks
 * @since 0.1.0
 */
export type Decision<Value> =
  | { readonly action: "continue" }
  | { readonly action: "modify"; readonly value: Value }
  | { readonly action: "reject"; readonly reason: string }
  | { readonly action: "error"; readonly message: string };
