# Independent change-detector review

Reviewer role: Skill Sicko. Instructions: `/Users/workgyver/.agents/skills/change-detector-tests/references/skill-sicko.md`.

Reviewed copies under `/tmp/nyte-change-detector-review/corpus`. Initial review was read-only. Paths and line references in the verdicts refer to that corpus, before cleanup.

| Path | Verdict | Reason and action |
| --- | --- | --- |
| `packages/tui/test/keymap.test.ts` | IMPORTANT | Lines 57–76 are MUST_KILL: the sole proof is an ordered list of fake command callbacks. Rewrite through rendered or SDK outcomes. Remove `ran` assertions at 89/97 while keeping `defaultPrevented` results. Remove `dispatched` instrumentation at 167/175/195; the actual aborted run at 198 proves the behavior. Keep pure return-value tests. |
| `packages/core/test/kernel/step.test.ts` | IMPORTANT | The local `Script` records `responds` and `toolBatches`; assertions on those arrays encode internal calls. Examples: 131–132, 178, 236, 303, 376/383, 410/413, 436, 524. Keep durable branch, run, queue, lease and event assertions. Remove recording and use durable outcomes; use a real bound turn where necessary to retain regression coverage. |
| `packages/core/test/kernel/compaction.test.ts` | IMPORTANT | The final test's fake local `Turn` and `seen === [7, 1]` at 349–381 prove a call sequence. Keep checkpoint/ref/results assertions. Exercise the actual turn and check the summary and retained messages sent to the provider. Other tests assert results or replace the external model boundary. |
| `packages/core/test/kernel/sdk-admission.test.ts` | IMPORTANT | `store.opened.length === 2` at 258 mandates duplicate opens. A correct optimization that opens once would fail. Remove this assertion; retain proof of exactly one usable session before shutdown and none afterward. Other tests exercise real SDK/SQLite behavior. |
| `packages/core/test/kernel/turn.test.ts` | KEEP | Returned messages, durable effects, recovery and fencing provide substantive proof. The scripted provider replaces the network boundary. Tool/hook fixtures implement extension behavior; exactly-once checks protect observable side effects. |
| `packages/core/test/kernel/context.test.ts` | KEEP | Assertions concern projected context from actual commits and persistence. |
| `packages/core/test/kernel/provider-compaction.test.ts` | KEEP | Assertions cover returned/persisted checkpoints, portable context, cancellation and lease release. The scripted provider replaces the network boundary; hook payloads are a public plugin contract. |
| `packages/ai/test/openai-compaction.test.ts` | KEEP | Actual HTTP against a local endpoint proves wire payload, authentication, result decoding and rejection behavior. |
| `packages/ai/test/openai-codex-account-compaction.test.ts` | KEEP | Fetch replaces the external ChatGPT service. Assertions cover its protocol, returned data and bounded network retries. |
| `packages/plugin/test/openai-compaction.test.ts` | KEEP | Real plugin/SDK execution plus loopback HTTP proves provider selection, authentication, opaque context replay and fallback. |
| `packages/tui/test/interactive-compaction.test.ts` | KEEP | Rendered interaction and the actual SDK prove cancellation, unchanged head and restored composer. Remove debug logging and writes to `/tmp/nyte-tui-compact-debug.txt` as cleanup. |
| `packages/tui/test/shell-interaction.test.ts` | KEEP | Assertions concern typed text, selection and focus. Mouse coordinates come from the current rendered elements or located visible text. These are dynamic interaction targets, not hardcoded pixel handles or layout-coordinate oracles. Layout changes can move the targets without invalidating the behavior checks. |

## Accepted core cleanup

Applied to the live workspace after authorization, limited to `step.test.ts`, `compaction.test.ts` and `sdk-admission.test.ts`:

- Removed `Script.responds` and `Script.toolBatches` recording and their assertions. Durable run/head refs now prove parked and backoff states remain unchanged; durable attempts and committed answers prove progress. Remaining scripted turn outcomes supply state-transition inputs, with assertions on actual SQLite results.
- Replaced the compaction test's fake local `Turn` with `bindTurn`. Only provider streams are scripted. The next assistant request must contain the summary and latest user input and omit the discarded old question.
- Removed the requirement that concurrent reads open exactly two session handles. The real handle usability and shutdown checks remain.
- Made the existing fencing test transfer lease ownership explicitly. Waiting for a short lease to expire is unreliable when the running turn renews it. The test still proves a fenced result publishes no answer or events.

Validation: `vitest --run test/kernel/step.test.ts test/kernel/compaction.test.ts test/kernel/sdk-admission.test.ts` passed all 31 tests across three files. Scoped Oxlint and Oxfmt checks passed. `tsc --noEmit -p /tmp/nyte-effect-typecheck.json` passed, including the three changed test files and the affected kernel source. Product code was not edited during this cleanup.

## Parked-run snapshot correction

The full kernel run exposed an intermittent assertion in `packages/core/test/kernel/sdk.test.ts`: after `runs.wait()` returned `waiting`, a later `runs.current()` snapshot sometimes contained a lease. These are separate observations. The runner consumes its own queued ref events and can briefly acquire a fresh lease, observe the unchanged waiting state, and release it. Waiting does not reserve that future snapshot against another acquisition.

Bounded reproduction: `parked-lease-observation.mjs` uses real SQLite, the SDK, a real waiting tool and a scripted network provider. It delays delivery of the runner's own parking event and completion of the resulting lease acquisition, producing the interleaving deterministically. Output:

```json
{"wait":"waiting","laterPhase":"waiting","laterLeasePresent":true,"settledLeasePresent":false,"before":{"providerRequests":1,"toolExecutions":1,"seq":9},"after":{"providerRequests":1,"toolExecutions":1,"seq":9}}
```

The extra wake changed no durable event and reran neither provider nor tool. Removed only the later `lease === undefined` assertion; retained waiting state, successful reply, final transcript and rejected late-reply assertions. Redundant wake suppression is a separate scheduling optimization and was not changed here. One focused verification of `sdk.test.ts` passed all 15 tests.
