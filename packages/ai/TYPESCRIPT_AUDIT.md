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

### 1. Anthropic SSE event decoding — resolved

[`anthropic-events.ts`](src/api/anthropic-events.ts) now defines TypeBox schemas for the wire fields
Nyte consumes (`UsageSchema`, `ContentBlockSchema`, `ContentDeltaSchema`) and derives the reducer's
event union from them, consumed by [`anthropic-messages.ts`](src/api/anthropic-messages.ts).
`parseJsonWithRepair` and its caller-selected generic are gone;
[`json-parse.ts`](src/utils/json-parse.ts) exports only `repairJson` and `parseStreamingJson`.
Selecting an SSE event name now validates its body.

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

[`validation.ts`](src/utils/validation.ts) maintains a handwritten JSON Schema subset, casts it to TypeBox schema types, and branches on a TypeBox symbol. A blanket replacement with `Value.Convert` would change behavior. The tests cover serialized-schema primitive coercion, unions, and optional non-nullable properties receiving `null`.

[`ToolCall.arguments`](../schema/src/message.ts) is still `Record<string, any>`. [`agent-loop.ts`](../core/src/agent-loop.ts) validates before execution and after hook modifications, which is a boundary worth retaining.

Next: distinguish unvalidated tool arguments from the selected tool's schema-derived arguments. Normalize accepted serialized schemas once. Test the existing coercion matrix before deleting the recursive compatibility walker. Do not replace it with a collection of one-line schema checks that merely hide the same algorithm.

### 5. Some runtime probes are real boundary work

[`opencode-catalog.ts`](src/providers/opencode-catalog.ts) already checks schemas but leaves many nested fields unknown, then normalizes them individually. It deliberately isolates malformed provider subtrees and defaults malformed optional values. Tightening the entire catalog into one all-or-nothing schema would lose that behavior.

[`error-body.ts`](src/utils/error-body.ts) consumes thrown values and several SDK error formats. Its plain-object and stream checks prevent response internals from replacing a useful error message. These are not equivalent to the deleted guards over already-typed message content.

Next: define provider-specific decoded catalog/error shapes at ingress, preserving partial catalog recovery and useful error text. Keep model-name predicates, numeric checks, and data fields such as `isError`; an `is*` spelling alone is not a type defect.

### 6. Test checking is fixed; script checking remains incomplete

The later test cleanup moved the surviving Pi-derived tests into `test/`, removed duplicate OAuth
suites and stale exclusions, and ported the catalog type checks to Nyte's providers.
[`tsconfig.json`](tsconfig.json) now includes `test/**/*.ts`, covering all tests and fixtures.
Anthropic and Responses tests use injected HTTP fixtures rather than SDK mocks. Removing the
second Anthropic OAuth suite also removed the fixed callback-port collision in parallel runs.

Scripts are still not directly included in the package typecheck. The audit found lint
diagnostics in [`generate-models.ts`](scripts/generate-models.ts), including casts of fetched catalog
data. Validate each upstream catalog before generating typed model constants. Do not edit generated
files to hide generator defects.

## Validation at the time of this audit

The audit's lint inventory (775 diagnostics before, 714 after) was taken under a configuration this
repository no longer uses. Under the repository's own `pnpm lint`, `oxlint packages/ai` reports zero
warnings and zero errors across 140 files. Treat the inventory as history, not as a count to
reproduce. No lint rule, severity, suppression, or ignore was changed for this audit.

Checks:

- Model-data check passed.
- Package typecheck passed, plus an expanded check for the changed upstream test.
- Tests passed with `vitest --run --no-file-parallelism`. `vitest.config.ts` includes
  `test/**/*.ts` with no exclusions; the suite has grown since the audit, so the count recorded
  here was removed rather than left stale.
- Formatting and whitespace checks passed for the changes.
- Lazy streams, the event queue, `StringEnum`, and all five added or rewritten test files pass lint with unused-disable reporting.
- Change-detector classification returned KEEP for all five test files. They assert emitted events, wire payloads, parsed values, or terminal results rather than implementation call sequences.
- An independent audit/critic could not run because the subagent service returned a usage-credit error. The review was completed directly.

Next implementation order: payload replacement, the shared model/API relationship, then tool-schema
normalization. These remove unsafe claims at their source.
