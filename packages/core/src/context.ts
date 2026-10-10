import type { Models } from "@nyte-ai/ai";
import type {
  CommitId,
  Configuration,
  HeadName,
  ModelContext,
  RunView,
  SessionId,
  ToolInfo,
  Transcript,
} from "@nyte-ai/schema";
import type { Context, ProviderCheckpointMaterial } from "@nyte-ai/schema/model";
import type { Kernel } from "./kernel.ts";
import type { ToolSource } from "./tool-runner.ts";

/** Assembles what one request on a head sends, before `transform_context`. `system` is the prompt: a `replace` from the session record (`sessions.create({ prompt })`), else from the configuration's agent (`Agent.prompt`), is the whole prompt byte for byte; else a `Resources.prompt.system` (SYSTEM.md, project over user, as scanned) is the whole prompt with `Resources.prompt.append` after it; else the session's `prompt` registry sections plus a session `layer` (section id `session`) and an agent `layer` (section id `agent`), each at its order (default 100), sorted by order then id and rendered as `<NNNN-id>` blocks (`<0010-project-context>`, text, closing tag; order zero-padded to four digits), then `Resources.prompt.append` (APPEND_SYSTEM.md) when there is one. `messages` are the head's committed path from the fold, oldest first, plus `run`'s settled parts not yet on it; pending inputs, live parts and failed parts are left out. A user message becomes a `UserMessage`: text as text; a `file` the model takes (`ModelInfo.input` of `configuration.model` has `image` and the mime is an image) as image content read from the blob store, any other file as a text reference naming it, its size and mime; a `reference` read through the session environment's files at this request (`kernel.env`), text inline under its path, anything else or an unreadable path as a text reference. A run of text, thinking and tool parts becomes one `AssistantMessage` (`api`, `provider` and `model` the provider identity of the run's model, a fast sibling recorded as its base, zero usage, `stopReason` `toolUse` when it holds calls, else `stop`), a text or thinking part after a tool part starting the next one: text as text with its `signature` (§38f) as the content's `textSignature`; thinking split back into one block per merged thought by its `signature`'s lengths, each with its own `thinkingSignature` and `redacted`, or one unsigned block when the signature is null; a tool part as its `toolCall` (id the call id, its name and args); each tool part then yields a `ToolResultMessage` after its assistant message from its settled outcome (`ok` content as text and images, filtered by `ModelInfo.input` like user files; `failed`, `interrupted`, `rejected` and `stopped` as text saying so, `isError` set). A compaction part's commit removes the commits it `replaces` and puts its summary, as a user message saying the earlier conversation was summarised, where the first of them stood (a material-only compaction puts nothing; `providerContext` carries its `{ provider, api, model, data }` material, §38e). A branch summary part is a user message saying what the abandoned path did. Any other part is a user message with its definition's `fallback` text, re-projected from its current state; a part whose kind this host does not know is left out. */
export function buildContext(
  kernel: Kernel,
  models: Models,
  session: SessionId,
  head: HeadName,
  run: RunView | null,
  configuration: Configuration,
): Promise<ModelContext> {
  throw new Error("not implemented");
}

/** Returns the request body `transform_transcript` receives after `transform_context`: `messages` the context's system prompt as one leading `SystemMessage` (none when empty), then its messages; `tools` the given tools the model may call (`exposure` `model`; a deferred tool the run activated is listed as `model` already), in the order given. */
export function transcriptOf(
  kernel: Kernel,
  session: SessionId,
  context: ModelContext,
  tools: readonly ToolInfo[],
): Transcript {
  throw new Error("not implemented");
}

/** Returns an estimate of a request body's tokens: `estimateMessageTokens` from `@nyte-ai/ai/utils/estimate` over each message, the leading system message included (§38m; characters / 4, images at a fixed size), plus `estimateTextTokens` over each tool's name, description and JSON Schema. What the compaction threshold and `ContextView.tokens` compare before a provider reports. */
export function tokenEstimate(transcript: Transcript): number {
  throw new Error("not implemented");
}

/** Returns the commit `buildContext` projected a message from, by identity (each message it builds is remembered in a per-process weak map): a user commit's message, a part commit's assistant or tool result message, a compaction commit's summary. Null for a message a transform made or replaced. What compaction maps its split back to commits with. */
export function projectedCommit(message: Transcript["messages"][number]): CommitId | null {
  throw new Error("not implemented");
}

/** Lowers a transcript to ai's request `Context`: its leading system message carries the tools as `toolsAdded` (`Context.tools` would add a second leading message), each `ToolInfo` as a `Tool` with its JSON Schema `parameters` and, when the tool's definition (`source.get(name)`) has a `grammar`, `constrainedSampling` of kind `grammar` with the `openai_lark` or `openai_regex` variant; the rest of the messages follow as they are; `checkpoint` is set when given: the caller passes the head's latest compaction `material` as `{ type: "provider", provider, api, model, data }` when its provider, api and model equal the request model's provider identity (§38e), else null. */
export function providerContext(
  transcript: Transcript,
  source: ToolSource,
  checkpoint: ProviderCheckpointMaterial | null,
): Context {
  throw new Error("not implemented");
}
