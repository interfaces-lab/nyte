import type { Models } from "@nyte-ai/ai";
import type {
  Configuration,
  HeadName,
  MessageId,
  ModelInfo,
  RunView,
  SessionId,
  Transcript,
} from "@nyte-ai/schema";
import type { Compactor, Kernel, Summarizer } from "./kernel.ts";

/** Returns the manual compaction `Head.compact` starts once it found no live run: what `kernel.compact` holds. Resolves the head's configuration (`kernel.resolveConfiguration` with its stored selection and no patch; a failure throws `SdkError("invalid")`), builds its request body as a turn pass does with no run (`buildContext`, `transform_context`, the session's tools, `transcriptOf`, `transform_transcript`) and splits it as `compactIfNeeded` does with reason `manual` and the given `instructions`; nothing to summarise (no committed message before the retained tail) answers `nothing-to-compact`. Otherwise it mints the part id, writes the `compaction` part live (placement transcript `note`, owner null, run null, state `{ summary: null, material: null, tokensBefore, usage: null }`) and answers `started { message }` with that id at once; the summary runs in the background as `compactIfNeeded`'s does, then `[part updated, part settled, commit { kind: "compaction", part, replaces }, head moved]` in one set, or `part failed { failure }` when the request or a hook fails, or when the head moved meanwhile (`stale`). */
export function createCompactor(kernel: Kernel, models: Models): Compactor {
  throw new Error("not implemented");
}

/** Compacts a run's request body when it no longer fits, after `transform_transcript` and before `before_request` (§38s): skipped while `tokenEstimate(transcript)` is at most `info.compactAt` (reason `threshold`; reason `overflow`, after the provider reported a context overflow, always compacts). Splits the transformed transcript's messages after its leading system message into what is summarised and the retained tail (`keep`: the newest messages within a fifth of the window, from the latest user message when that fits, never parting a tool call from its result); nothing before the tail → skipped. Dispatches `before_compaction` (transform, 300 s budget) with a `CompactionPlan` `{ model, reason, instructions: null, tokensBefore, summarise, keep, result: null }`. A plan with `result` set is written as given without a request (`summary` text, or provider `material` `{ provider, api, model, data }` with its usage, §38e); otherwise one request summarises `plan.summarise` with `plan.model`, `before_request` (step `compaction`) applied to it and `after_request` observed, under `RETRY_POLICY`. The `compaction` part (id minted, placement transcript `note`, owner null, `run` this run, state `{ summary, material, tokensBefore, usage }`) and the commit `{ kind: "compaction", part, replaces }` (`replaces` the committed path's commits older than the oldest commit a `keep` message projects from, `projectedCommit`; when no `keep` message maps to a commit, the commits the `summarise` messages project from) land in one set with `[part created, part settled, commit]`, plus a `request` event with step `compaction` when a request ran. Resolves `compacted { message }` with the part id; a failed summary request throws, failing the run. */
export function compactIfNeeded(
  kernel: Kernel,
  models: Models,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunView;
    readonly configuration: Configuration;
    readonly transcript: Transcript;
    readonly info: ModelInfo;
    readonly reason: "threshold" | "overflow";
    readonly signal: AbortSignal;
  },
): Promise<
  { readonly kind: "compacted"; readonly message: MessageId } | { readonly kind: "skipped" }
> {
  throw new Error("not implemented");
}

/** Returns the summariser `move({ abandoned: summarize })` runs: what `kernel.summarize` holds. Reads the abandoned commits from the fold as text (user content as text, text parts as markdown, a tool part as its name, arguments and outcome in one line, any other part as its `fallback`), resolves the head's configuration as `createCompactor` does, and sends one request with that model asking for a short markdown summary of what the abandoned path tried and found, following `instructions` when given: `before_request` with step `summary`, `RETRY_POLICY`, `after_request` observed and a `request` event with step `summary` on the head. Resolves `ok { markdown, usage }`, or `failed { reason }` when the request fails or the signal aborts; no commit is abandoned → `ok` with empty markdown and zero usage. */
export function createSummarizer(kernel: Kernel, models: Models): Summarizer {
  throw new Error("not implemented");
}
