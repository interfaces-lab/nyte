# TypeScript audit

## Comparison points

Pi's remote no longer advertises `dev`. This audit used `main` at `9841914c71a74d81abe07f751aefd271fd924e63` and checked the Chat Completions adapter's pinned revision, `77f2d1235ee2992c6072b9dcb6e99439a70c6f45`. OpenCode was checked at `v2`, revision `41cb354c3eac138959b1a6c4690385b7c3a6d666`.

Pi is useful for provider compatibility, but is not a type-safety reference. Its current [Chat Completions adapter](https://github.com/earendil-works/pi/blob/9841914c71a74d81abe07f751aefd271fd924e63/packages/ai/src/api/openai-completions.ts) still widens content to `{ type: string }` before reconstructing types with guards. Its [JSON parser](https://github.com/earendil-works/pi/blob/9841914c71a74d81abe07f751aefd271fd924e63/packages/ai/src/utils/json-parse.ts) still lets callers choose an unchecked return type.

OpenCode's newer AI package puts request and event codecs in its [protocol contract](https://github.com/anomalyco/opencode/blob/41cb354c3eac138959b1a6c4690385b7c3a6d666/packages/ai/src/route/protocol.ts). Its [Chat protocol](https://github.com/anomalyco/opencode/blob/41cb354c3eac138959b1a6c4690385b7c3a6d666/packages/ai/src/protocols/openai-chat.ts) derives types from schemas. Its [tool stream](https://github.com/anomalyco/opencode/blob/41cb354c3eac138959b1a6c4690385b7c3a6d666/packages/ai/src/protocols/utils/tool-stream.ts) keeps pending argument text separate from emitted tool calls. Those are useful patterns for Nyte. They do not require adopting Effect or replacing the SDKs.

The detailed review covered adapter conversion and streaming, JSON recovery, tool validation, provider dispatch, catalog parsing, error normalization, and test coverage. The lint inventory covers all of `packages/ai`, including scripts and excluded upstream tests. This is a targeted implementation pass with remaining work listed below, not a completed package-wide lint cleanup.

## Changes made

- Removed Chat Completions content guards and redundant predicates. Existing message discriminants now narrow their own content.
- Allocated typed streaming blocks before assigning them to the assistant message. Removed the reverse cast and narrowed tool-call scratch cleanup.
- Replaced reasoning-detail guards and mirrored interfaces with TypeBox schemas and derived types. Unknown provider extension fields survive replay.
- Removed unnecessary SDK parameter casts. Kept the optional tool-result `name` extension explicit. Timeout is assigned only when present because OpenAI rejects `timeout: undefined`.
- Removed Responses conversion casts and its generic slot-casting helper. Slot discriminants narrow the actual map entries. Scratch cleanup uses property checks.
- Narrowed lazy setup to the stream contract its callers actually return. Removed result-method probing and single-use forwarding/error helpers.
- Replaced the event stream's asserted promise resolver with `Promise.withResolvers`. Removed queue assertions without changing competing-consumer order or dropping queued `undefined` values.
- Changed `StringEnum` to `Type.Enum`, preserving literal inference and the string enum wire format without `Type.Unsafe`. Empty-string defaults and descriptions now survive.
- Removed the caller-selected generic from streaming argument parsing. Its result is schema-checked to be an object. Arrays, scalars, and `null` become the existing empty-object fallback. Nested argument values still need the selected tool's schema validation.
- Repaired string literals before partial parsing, which otherwise can silently drop fields containing raw control characters.
- Added behavior tests for those changes. Replaced the Responses terminal-event SDK mock and `push` interception with injected HTTP responses through the real SDK.

## Remaining findings

### 1. Anthropic SSE still claims an unchecked event type

[`iterateAnthropicEvents`](src/api/anthropic-messages.ts) calls `parseJsonWithRepair<RawMessageStreamEvent>`. The generic in [`json-parse.ts`](src/utils/json-parse.ts) only casts `JSON.parse` output. Selecting an SSE event name does not validate its body, usage counters, content blocks, or deltas.

The streaming-argument generic is fixed. This separate generic remains because removing it requires a real Anthropic event decoder, not moving its cast to the caller.

Next: define schemas for the wire fields Nyte consumes, retain supported proxy extensions, and derive the reducer's event union from those schemas. Test malformed known events, unknown events, repaired JSON, and early EOF through the actual SSE reader. Do not mirror every SDK interface or assert the result back to the full SDK event type.

### 2. Model unions lose the relationship between API and compatibility options

[`Model<TApi>`](../schema/src/model.ts) has `api: TApi` and a separate conditional `compat` property. `Model<Api>` therefore permits combinations that a concrete `Model<"anthropic-messages">` would reject. [`hasApi`](src/models.ts) checks only `api` and then promises the narrower model.

A temporary typecheck probe accepted this combination with no assertions:

```ts
const mixed: Model<Api> = {
  ...OPENAI_MODELS["gpt-5.4"],
  api: "anthropic-messages",
  compat: { maxTokensField: "max_tokens" },
};
```

It also accepted treating `mixed` as `Model<"anthropic-messages">` after `hasApi`. The probe was removed after verification.

Next: preserve this relationship in the shared model type as a union of concrete API variants. Give custom APIs an explicit contract rather than letting a broad string variant erase the relationship. This belongs in `packages/schema`; adding more guards in AI adapters will not repair it.

### 3. Payload replacement and provider dispatch erase useful types

[`ProviderRequestOptions.onPayload`](src/types.ts) accepts and returns `unknown`. Adapters cast its replacement back to SDK request types. A callback can therefore produce an invalid request while the compiler treats it as valid.

[`createProvider`](src/models.ts) also accepts either a stream implementation or an API-keyed map under the same property. It distinguishes them by probing `stream`, then casts both alternatives. `ProviderStreams` deliberately erases per-API option types.

Next: carry the request body type through concrete adapter options. Validate replacements when a genuinely untyped extension crosses in. Separate single-implementation and API-map construction so dispatch does not need structural guessing. Preserve custom-provider support and deferred operations during that change.

### 4. Tool coercion needs one explicit schema contract

[`validation.ts`](src/utils/validation.ts) maintains a handwritten JSON Schema subset, casts it to TypeBox schema types, branches on a TypeBox symbol, and uses `any` for validated results. A blanket replacement with `Value.Convert` would change behavior. The tests cover serialized-schema primitive coercion, unions, and optional non-nullable properties receiving `null`.

[`ToolCall.arguments`](../schema/src/message.ts) is still `Record<string, any>`. [`agent-loop.ts`](../core/src/agent-loop.ts) validates before execution and after hook modifications, which is a boundary worth retaining.

Next: distinguish unvalidated tool arguments from the selected tool's schema-derived arguments. Normalize accepted serialized schemas once. Test the existing coercion matrix before deleting the recursive compatibility walker. Do not replace it with a collection of one-line schema checks that merely hide the same algorithm.

### 5. Some runtime probes are real boundary work

[`opencode-catalog.ts`](src/providers/opencode-catalog.ts) already checks schemas but leaves many nested fields unknown, then normalizes them individually. It deliberately isolates malformed provider subtrees and defaults malformed optional values. Tightening the entire catalog into one all-or-nothing schema would lose that behavior.

[`error-body.ts`](src/utils/error-body.ts) consumes thrown values and several SDK error formats. Its plain-object and stream checks prevent response internals from replacing a useful error message. These are not equivalent to the deleted guards over already-typed message content.

Next: define provider-specific decoded catalog/error shapes at ingress, preserving partial catalog recovery and useful error text. Keep model-name predicates, numeric checks, and data fields such as `isError`; an `is*` spelling alone is not a type defect.

### 6. Test and script checking is incomplete

[`tsconfig.json`](tsconfig.json) includes direct `test/*.ts` files, but not `test/upstream/**/*.ts` or scripts. A green package typecheck does not cover them. The changed upstream terminal-event test was checked with a temporary expanded config as well.

[`vitest.config.ts`](vitest.config.ts) excludes upstream tests that still depend on Pi's removed registry. Port relevant cases to explicit Nyte models rather than restoring the registry or replacing whole SDK modules. The new Chat tests cover reasoning replay and grouped tool-result images through HTTP.

Two enabled Anthropic OAuth test files exercise the same fixed callback port. A parallel run failed with `EADDRINUSE`; serial execution passed all files. Consolidate the duplicate cases or isolate their execution without changing the provider's redirect URI.

[`generate-models.ts`](scripts/generate-models.ts) accounts for 68 lint diagnostics and casts fetched catalog data. Validate each upstream catalog before generating typed model constants. Do not edit generated files to hide generator defects.

## Validation and remaining lint

| Location | Before | After |
| --- | ---: | ---: |
| Source | 451 | 407 |
| Tests | 254 | 237 |
| Scripts | 70 | 70 |
| Total | 775 | 714 |

All 714 remaining diagnostics are errors. No lint rule, severity, suppression, or ignore was changed for this audit.

Checks:

- Model-data check passed.
- Package typecheck passed, plus an expanded check for the changed upstream test.
- 341 tests passed across 44 files with `vitest --run --no-file-parallelism`. This count excludes the files already excluded by the existing configuration.
- Formatting and whitespace checks passed for the changes.
- Lazy streams, the event queue, `StringEnum`, and all five added or rewritten test files pass lint with unused-disable reporting.
- Change-detector classification returned KEEP for all five test files. They assert emitted events, wire payloads, parsed values, or terminal results rather than implementation call sequences.
- An independent audit/critic could not run because the subagent service returned a usage-credit error. The review was completed directly.

Next implementation order: Anthropic wire decoding and payload replacement, the shared model/API relationship, then tool-schema normalization. These remove unsafe claims at their source. Mechanically rewriting the remaining lint sites would leave the underlying contracts unchanged.
