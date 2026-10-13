import type { Failure, Message as ModelMessage } from "./model/message.ts";
import type { ModelRef, Thinking, Usage } from "./models.ts";
import type { Schema } from "./schema.ts";

/**
 * Returns a prompt change: one more section at an order, or the whole prompt
 * replaced.
 *
 * @see {@link Agent.prompt}
 * @category plugins
 * @since 0.1.0
 */
export type PromptOverride =
  | { readonly kind: "layer"; readonly text: string; readonly order?: number }
  | { readonly kind: "replace"; readonly text: string };

/**
 * Describes a plugin's own model request: not a run, so no tools, no
 * transcript and no parts.
 *
 * **Details**
 *
 * Charged to the session and reported on `after_request` with step
 * "plugin".
 *
 * **Example** (The rename plugin)
 *
 * ```ts
 * import { z } from "zod";
 *
 * declare const api: PluginApi<"core">;
 * declare const transcriptText: string;
 *
 * const { configuration } = await api.session.view();
 * if (configuration.effective !== null) {
 *   const title = await api.request({
 *     model: configuration.effective.model,
 *     system: "Name this chat in five words.",
 *     messages: [{ role: "user", content: transcriptText }],
 *     output: z.object({ title: z.string().max(60) }),
 *   });
 *   if (title.kind === "ok") await api.session.update({ name: title.value.title });
 * }
 * ```
 *
 * @category plugins
 * @since 0.1.0
 */
export type ModelRequestInput<T = string> = {
  /** Any catalog model; the session's effective one is `api.session.view().configuration.effective.model`. */
  readonly model: ModelRef;
  readonly system?: string;
  /** Provider-facing messages: build from `view.messages`, or hand-write a user turn. */
  readonly messages: readonly ModelMessage[];
  /** Default off. */
  readonly thinking?: Thinking;
  /** Structured output: the provider is asked for JSON matching it; the result is validated. */
  readonly output?: Schema<T>;
  readonly maxOutput?: number;
  readonly signal?: AbortSignal;
};

/**
 * Returns the result of a plugin's model request.
 *
 * **Outcomes**
 *
 * - `ok`: `value` is text, or the parsed structured output; `stop` says whether it ran out of length.
 * - `refused`: the provider refused; no retry.
 * - `failed`: `failure` after the provider retry policy.
 *
 * @category plugins
 * @since 0.1.0
 */
export type ModelRequestOutcome<T = string> =
  | {
      readonly kind: "ok";
      readonly value: T;
      readonly usage: Usage;
      readonly stop: "end" | "length";
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly failure: Failure };
