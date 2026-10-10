import type { Models } from "@nyte-ai/ai";
import type { PartId, RunView, Usage } from "@nyte-ai/schema";
import type { AssistantMessage, Failure } from "@nyte-ai/schema/model";
import type { Kernel, TurnDriver } from "./kernel.ts";

/** Returns one tool call as the provider streamed it. */
type ModelToolCall = Extract<AssistantMessage["content"][number], { readonly type: "toolCall" }>;

/** Returns one merged thought's share of a thinking part's `signature` (§38f): its length in the part's markdown, so a replay splits the thoughts back, and the provider's `thinkingSignature` and `redacted` for it. */
type ThoughtSignature = {
  readonly length: number;
  readonly signature: string | null;
  readonly redacted: boolean;
};

/** Returns one text or thinking part a request has open: its id, kind, the markdown streamed into it so far, its provider continuity data, and for thinking how many adjacent thoughts it holds. Settled, a text part's `signature` is `textSignature` and a thinking part's is `thoughts`, or null when no thought carried a signature and none was redacted. */
interface OpenPart {
  readonly part: PartId;
  readonly kind: "text" | "thinking";
  markdown: string;
  merged: number;
  /** Text: the content's `textSignature` from its `text_end`, else null. */
  textSignature: string | null;
  /** Thinking: one entry per merged thought, in order. */
  readonly thoughts: ThoughtSignature[];
}

/** Returns what one attempt of a run holds in memory while its requests stream; a re-drive rebuilds it from the fold. */
interface AttemptState {
  readonly run: RunView;
  /** The run record's `view.attempt`, which every `run retrying` bumps (§38t). */
  readonly attempt: number;
  /** The index the attempt's next text or thinking part takes in its id `${run}:${attempt}:${index}`, counted from 0 across the attempt's requests. */
  index: number;
  /** The current request's open text and thinking parts, by the provider's content index. */
  readonly parts: Map<number, OpenPart>;
  /** The thinking part the next thought merges into; null once text or a tool call streamed after it. */
  merging: OpenPart | null;
  /** The usage of every request the run settled, compaction's included: `RunEnd.completed`'s total. */
  usage: Usage;
}

/** Returns how one provider request's stream ended, with the usage it was charged. */
type StreamOutcome =
  | {
      readonly kind: "done";
      readonly message: AssistantMessage;
      readonly stop: "stop" | "length" | "toolUse";
      readonly calls: readonly ModelToolCall[];
      readonly usage: Usage;
    }
  | { readonly kind: "overflow"; readonly message: AssistantMessage; readonly usage: Usage }
  | {
      readonly kind: "failed";
      readonly message: AssistantMessage;
      readonly failure: Failure;
      readonly retryable: boolean;
      readonly usage: Usage;
    }
  | { readonly kind: "stopped" };

/** Returns the turn driver `advance` runs a run's turn with: what `kernel.turn` holds. `run_started` and `run_ended` are observed by `startRun` and `endRun` once logged (§38q, n); the turn observes neither. A run driven again with live text or thinking parts of its own (the host died mid-stream) fails them and takes the next attempt (`run retrying` with `until` now). Then it loops, one provider request per pass, in the baseline's hook order (§38s): `buildContext` (the run's configuration) → `transform_context` → the run's tools (`kernel.tools(session, run).list()`, narrowed to the agent's `tools` when its configuration's agent names some) → `transcriptOf` → `transform_transcript` → `compactIfNeeded` on the transformed transcript (reason `threshold`; `before_compaction` inside; a compaction rebuilds the body through both transforms again, without compacting twice in one pass) → `before_request` (`ModelRequest { model, thinking, step: "assistant", attempt, options: { sampling: {}, headers: {} } }`; a model the catalog lacks fails the run `runner`) → `run phase responding` (clearing `retrying`) → `models.streamSimple(model, providerContext(...), { signal, reasoning, samplingParams, headers, maxTokens, sessionId })`, `reasoning` the request's thinking (none for `"off"`; ai lowers a level through the model's `thinkingLevelMap` and a fast ref to its base with the mode set). Stream events become parts through `createPart` with `run`, `head` and `CORE_CONTEXT`: `text_start` opens a `text` part (placement transcript `answer`, id `${run}:${attempt}:${index}`, `signature` null), `thinking_start` opens a `thinking` part (transcript `step`, `merged` 1, `signature` null) unless it follows a thought, which it merges into (`merged` + 1, first id kept, markdown joined by a blank line); each delta is a `publishPatch` `append`; a part settles at its `*_end` (thinking once something else starts or the stream ends) with its final markdown and `signature` (§38f, as `OpenPart` says): `part updated`, `part settled` and its commit in one set. Tool calls wait for the stream's end. A `done` stream publishes a `request` event (`usageOf(message, info)`, `ContextView { tokens: the reported input, cache and output tokens, window: info.contextWindow, lastRequest }`, step `assistant`) riding the run ref and observes `after_request` (step `assistant`, `durationMs`); a length stop that ended short of the output limit (`isRecoverableLength`) is an overflow. An error the policy retries (`isRetryableAssistantError` and `retryDelayMs` from `@nyte-ai/ai/utils/retry`, up to `RETRY_POLICY.maxRetries` per request) fails the attempt's open parts with the failure, publishes `run retrying { attempt + 1, until: now + retryDelayMs, reason }` with the run record's `retrying` set and its `view.attempt` bumped in the same set (§38t), so part ids never repeat after a restart, sleeps until `until` (abortable; after a restart `advance` drives the run once `until` passed, §38o) and repeats the pass at the next attempt; an overflow (`isContextOverflow` from `@nyte-ai/ai/utils/overflow`) runs `compactIfNeeded` with reason `overflow` once per request and repeats as a retry; an abort is `stopped`; any other error, or a retry budget spent, ends the run `failed { failure }` (`classifyAssistantFailure` from `@nyte-ai/ai/utils/failure`). With no tool calls the run ends `completed { usage }`, the run's total. With calls: `run phase executing`, then each call in response order through `executeCall` (call id the provider's call id, as `LOCAL` with participant authority, the run's signal), each awaited until it settles or parks; a parked call does not hold back the next (§38k), so every call has its step record before the turn returns, and when any parked the turn returns without ending the run (`advance` reports `waiting`, §34d; a later drive resumes after `resume` re-ran it). Then `boundary()` lands joined inputs and the loop runs again. A stopped run (its fence passed, its signal aborted) ends `stopped`, its open parts already failed by the fence. */
export function createTurnDriver(kernel: Kernel, models: Models): TurnDriver {
  throw new Error("not implemented");
}
