**Core code-quality audit, September 4, 2026**

Start by removing the obsolete core implementation, then repair ownership of session opening, message admission, compaction, and tool-result settlement. Splitting the largest files first would distribute several existing bugs across more files.

This is an audit of the current working tree, including its pre-existing migration work. Application source, dependencies, and lint configuration were not changed. Repository-wide coverage comprises file inventory and lint; the deeper structural review and runtime reproductions focus on core. Sizes and diagnostic counts are snapshots taken during this pass.

**Large files first**

Thirteen owned production-source files exceed 1,000 lines. Generated output, dependencies, tests, and scripts are excluded from that count. The model-generation script is separately large at 3,148 lines.

| Core file | Lines | Main concern |
| --- | ---: | --- |
| [kernel/sdk/nyte.ts](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts:279) | 1,905 | Pooling, activation, runner scheduling, delegation, SDK operations, event watching, and shutdown share mutable state. |
| [kernel/compaction.ts](/Users/workgyver/Developer/nyte/packages/core/src/kernel/compaction.ts:651) | 1,026 | Cut selection, summary generation, branch summaries, and publication have competing context-handling paths. |
| [kernel/sqlite.ts](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts:230) | 1,024 | Stored-value decoding, watcher lifecycle, transactions, and storage operations share one module. |
| [kernel/sdk/activation.ts](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/activation.ts:613) | 822 | Plugin activation and request adaptation are coupled through invocation state associated with abort signals. |
| [kernel/step.ts](/Users/workgyver/Developer/nyte/packages/core/src/kernel/step.ts:460) | 749 | Response sequencing and retry state use the same counter. |
| [kernel/turn.ts](/Users/workgyver/Developer/nyte/packages/core/src/kernel/turn.ts:243) | 743 | Tool execution, hooks, and durable settlement disagree about which result is final. |
| [obsolete sdk/types.ts](/Users/workgyver/Developer/nyte/packages/core/src/sdk/types.ts:9) | 725 | Dead contract still refers to removed modules. Delete after preserving useful tests. |
| [kernel/sdk/types.ts](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/types.ts:1) | 649 | Canonical public contract. Size alone does not justify fragmenting a cohesive contract. |

Other production-source files above 1,000 lines:

| File | Lines |
| --- | ---: |
| [tui/interactive.ts](/Users/workgyver/Developer/nyte/packages/tui/src/interactive.ts:1) | 2,474 |
| [ai/openai-codex-responses.ts](/Users/workgyver/Developer/nyte/packages/ai/src/api/openai-codex-responses.ts:1) | 1,973 |
| [desktop/composer.tsx](/Users/workgyver/Developer/nyte/packages/desktop/src/renderer/src/conversation/composer.tsx:1) | 1,906 |
| [ai/openai-completions.ts](/Users/workgyver/Developer/nyte/packages/ai/src/api/openai-completions.ts:1) | 1,799 |
| [tui/transcript.ts](/Users/workgyver/Developer/nyte/packages/tui/src/transcript.ts:1) | 1,720 |
| [ai/anthropic-messages.ts](/Users/workgyver/Developer/nyte/packages/ai/src/api/anthropic-messages.ts:1) | 1,656 |
| [desktop/conversation/styles.stylex.ts](/Users/workgyver/Developer/nyte/packages/desktop/src/renderer/src/conversation/styles.stylex.ts:1) | 1,367 |
| [desktop/thread.tsx](/Users/workgyver/Developer/nyte/packages/desktop/src/renderer/src/screens/thread.tsx:1) | 1,350 |
| [ai/models.ts](/Users/workgyver/Developer/nyte/packages/ai/src/models.ts:1) | 1,077 |
| [desktop/sidebar.tsx](/Users/workgyver/Developer/nyte/packages/desktop/src/renderer/src/chrome/sidebar.tsx:1) | 1,009 |

**Bad practices and anti-slop findings**

Anti-slop is already installed at [tools/oxlint/anti-slop](/Users/workgyver/Developer/nyte/tools/oxlint/anti-slop/index.ts:1). Both `oxlint` and `@oxlint/plugins` are pinned to `1.81.0`. All 15 generic rules are enabled as errors in [oxlint.config.ts](/Users/workgyver/Developer/nyte/oxlint.config.ts:27). No package manifest directly declares Effect, so its optional plugin is appropriately inactive. Nothing was copied or upgraded.

The local plugin differs from the bundled skill in several rules and has its own tests. The existing configuration permits `typeof` within type predicates, and the local rule also exempts comparisons with `"undefined"`. These are existing choices, not changes made by this audit. A passing lint result does not establish that a predicate validates its complete contract.

The repository lint run reports **971 errors and two warnings**, including **929 anti-slop findings**. Core contributes **102 errors**, of which **87 are anti-slop findings**.

| Pattern | Repository | Core | Cleanup implication |
| --- | ---: | ---: | --- |
| Type assertions without a safety justification | 302 | 12 | Trace the input contract. Adding a comment alone does not make an assertion safe. |
| Runtime `typeof` outside allowed boundaries | 197 | 26 | Find the owner of parsing instead of adding guards throughout consumers. |
| Explicit unknown parameters | 129 | 10 | Keep external parsing at a boundary and give internal operations concrete contracts. |
| Conditional empty-object spreads | 100 | 24 | Usually a local readability issue. In core, remove obsolete code before rewriting these. |
| Known-value widening | 87 | 9 | Preserve inference and source-owned types. |
| Unsafe dictionary types | 77 | 6 | Replace representation-driven access with the actual domain contract where needed. |

Core's 102 diagnostics divide into **59 in obsolete SDK/views/harness files**, **10 in the old MCP adapter**, **32 in tests**, and **one in active source**, a conditional spread in `kernel/sdk/snapshot.ts`. Most core lint work therefore disappears through completing the migration. The reproduced runtime bugs below are largely invisible to these rules.

The next broad lint hotspot after core is AI, with 750 diagnostics. Within it, `openai-completions.ts` has 78, `anthropic-messages.ts` 65, and `utils/validation.ts` 49. These identify where to inspect next; the counts are not proof of an equal number of bugs. TUI has 93 diagnostics. No runtime audit of those packages is claimed here.

**First core cleanup: remove the obsolete implementation**

Ten legacy source files total **2,163 lines**:

| Removal group | Lines |
| --- | ---: |
| `src/sdk/events.ts`, `snapshot.ts`, `types.ts` | 1,239 |
| `src/views/changes.ts`, `client.ts`, `presentation.ts`, `tree.ts`, `usage.ts` | 626 |
| `src/harness/compaction/branch-summary.ts`, `src/harness/suspension.ts` | 298 |

[Public exports](/Users/workgyver/Developer/nyte/packages/core/src/index.ts:9) and the [browser-safe entry](/Users/workgyver/Developer/nyte/packages/core/src/views.ts:2) already select the kernel implementation. The legacy group still imports removed harness and transcript modules and `@uji-ai/*` packages. Its surviving external consumer is an obsolete event-helper import in [tool-result.test.ts](/Users/workgyver/Developer/nyte/packages/core/test/tool-result.test.ts:9). Move that behavior assertion to the current event path before removal.

The old [MCP adapter](/Users/workgyver/Developer/nyte/packages/core/src/mcp.ts:10) is another 279 lines tied to missing dependencies and deleted harness contracts. Resolve whether its feature remains supported, then port it to the current contract or remove it. Do not install its old dependencies merely to make dead code compile.

Legacy tests should be migrated or removed only after checking whether current tests cover their behavior. Their import failures currently disable checks for SDK, retries, MCP, tool results, navigation, and workspace registry behavior.

**Reproduced bugs, in priority order**

1. **[P1] Waiting and recovery discard finalized tool results.** [turn.ts:583](/Users/workgyver/Developer/nyte/packages/core/src/kernel/turn.ts:583) persists raw tool output before [agent-loop.ts:317](/Users/workgyver/Developer/nyte/packages/core/src/agent-loop.ts:317) applies `after_tool` changes. If a sibling tool waits, the batch's patched results are discarded. Resume reads the raw durable result and [skips the hook](/Users/workgyver/Developer/nyte/packages/core/src/kernel/turn.ts:253).

   Reproduction changed `UNREDACTED` to `REDACTED` in the hook, parked a second tool, and resumed. Both the stored result and the resumed message contained `UNREDACTED`; the hook ran only once. This also affects error and usage patches. Give one layer ownership of hook finalization and durable settlement, and persist the final result. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-effect-audit.mjs).

2. **[P1] Repeated compaction can discard the previous summary.** [compaction.ts:665](/Users/workgyver/Developer/nyte/packages/core/src/kernel/compaction.ts:665) initializes history to `No prior history.` and only incorporates `previousSummary` when there are new history messages. When the cut splits the first retained turn, that message list is empty even though a previous summary exists.

   The reproduced checkpoint dropped `CRITICAL_PRIOR_SUMMARY`; no summarizer request contained it, and the replacement started with `No prior history.` Earlier context is absent from subsequent model requests. Carry forward the previous summary when no new history needs summarizing. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-core-audit.mjs).

3. **[P1] Concurrent messages can run with the wrong agent.** [nyte.ts:1312](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts:1312) submits agent selection separately from the keyed message. Two concurrent sends with distinct keys produced `config(agent-a), config(agent-b), prompt-a, prompt-b` in the actual lane. A real kernel step landed the first three changes and created the run for `prompt-a` with `agent-b`.

   Submit the agent selection and message as one atomic, idempotent operation. The same split also allows a duplicate message receipt to coexist with an additional unkeyed config submission. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-send-interleave.mts).

4. **[P1] Automatic compaction replaces the summarization system prompt with the agent persona.** [activation.ts:657](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/activation.ts:657) overwrites every request's system prompt. Threshold and overflow compaction pass through that wrapper even though the compaction module supplies its own prompt. The request hook also reports `step: "assistant"`.

   The reproduction produced a checkpoint while the provider received `NORMAL AGENT PERSONA` and the hook saw `assistant`. Manual compaction uses the raw stream and does not have this particular overwrite. Preserve the request's intended prompt and make its purpose explicit in the request operation. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-compaction-activation-repro.mjs).

5. **[P2] Successful responses consume the retry budget.** [turn.ts:362](/Users/workgyver/Developer/nyte/packages/core/src/kernel/turn.ts:362) compares total `run.attempts` with `maxRetries`. [step.ts:460](/Users/workgyver/Developer/nyte/packages/core/src/kernel/step.ts:460) increments that count after successful responses too.

   A complete run succeeded through three tool rounds, then failed on its first rate-limit response despite `maxRetries: 3`. It made four requests and entered `failed` without retrying. Track consecutive failures in retry state; keep response sequence separate. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-retry-audit.mjs).

6. **[P2] Concurrent first access leaks a session handle.** [nyte.ts:825](/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts:825) checks the pool, awaits a fact read, then inserts without checking again. Concurrent first reads both pass the check and one replaces the other's pooled entry.

   Two real SQLite-backed `sessions.get` calls opened handles 1 and 2. Closing Nyte closed only handle 2. Make each session's opening operation have one owner, or recheck after the await and close the loser. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-adopt-race.mts).

7. **[P2] Plugin reload and reorder disagree about precedence.** [host.ts:125](/Users/workgyver/Developer/nyte/packages/core/src/plugins/host.ts:125) skips unchanged versions without updating their stored order. Hooks instead follow [registration order](/Users/workgyver/Developer/nyte/packages/core/src/plugins/hooks.ts:249).

   Reordering `[A,B]` to `[B,A]` changed the inventory but left B winning both prompt and hook changes. Reloading A while keeping `[A,B]` then made A win the hook while B still won the prompt. Use one plugin ordering for contributions and hooks, preserving registration order within each plugin. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-plugin-order-repro.mjs).

8. **[P2] The native compaction hook is never invoked.** Core exposes [before_compaction](/Users/workgyver/Developer/nyte/packages/core/src/plugins/hooks.ts:51), and [the TUI registers a native provider handler](/Users/workgyver/Developer/nyte/packages/tui/src/plugins.ts:86), but neither automatic nor manual compaction calls it.

   The automatic-compaction reproduction registered the hook and completed a checkpoint with zero hook calls. Source tracing also shows manual compaction going directly to `writeCheckpoint`. Give both paths one compaction operation that invokes the hook and passes its material into the existing summarizer. This is separate from the incorrect automatic system prompt. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-compaction-activation-repro.mjs).

9. **[P2] Concurrent workspace-store instances lose updates.** [WorkspaceRegistry](/Users/workgyver/Developer/nyte/packages/core/src/workspace-registry.ts:93) and [WorkspaceTrustStore](/Users/workgyver/Developer/nyte/packages/core/src/workspace-trust.ts:106) serialize writes only within an instance. Two instances can read the same file, add different entries, and replace each other's result. Atomic rename prevents a partial file, not a lost read-modify-write update. Desktop and TUI deliberately share the trust path.

   Ten trials for each store concurrently added two distinct workspaces; every persisted file contained only one entry. Use a transaction or file lock shared by all writers, including separate processes. A per-process queue alone would not solve desktop/TUI coordination. [Reproduction](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-workspace-write-race.mjs).

**Cleanup sequence**

1. Remove the 2,163-line legacy group after preserving its useful tests. Resolve the old MCP adapter. Restore the compiler and test baseline before refactoring live orchestration.
2. Fix final-result settlement and summary retention. These currently change what the model sees after recovery or compaction.
3. Make session opening single-owner and agent-plus-message admission atomic. Then separate session lifecycle and delegation from the SDK's public operations.
4. Give automatic and manual compaction one request contract. Preserve request purpose, prompts, hooks, and provider checkpoint material. Separate consecutive retry failures from response sequence.
5. Consolidate plugin ordering and workspace write coordination. Only then split the remaining large modules along those actual responsibilities.

Do not repair the 59 lint findings in obsolete files individually, suppress rules, add comments to unsupported casts, or introduce generic dispatch frameworks just to reduce file length. A smaller design should remove duplicated decisions and invalid intermediate states.

**Validation and limits**

| Check | Result |
| --- | --- |
| Repository lint | 971 errors, 2 warnings; 929 anti-slop diagnostics. |
| Core lint | 102 errors; 87 anti-slop diagnostics. |
| Core TypeScript check | 197 errors, all located in legacy source/adapter files and affected tests in this run. |
| Core test run | 23 files passed, 6 failed to load; 157 tests passed. |
| Focused behavior reproductions | Verified the nine findings above; no live provider requests or user workspace mutations. |

The six load failures are `harness-retry.test.ts`, `mcp.test.ts`, `sdk.test.ts`, `tool-result.test.ts`, `tree-navigation.test.ts`, and `workspace-registry.test.ts`. Their failures are preserved in the test log.

The package-manager wrapper could not open its database under the sandbox. Checks therefore used the installed binaries directly: root `node_modules/.bin/oxlint` for lint, and the corresponding installed `tsc --noEmit` and `vitest --run` from `packages/core`. This did not install or change dependencies.

Raw evidence: [core lint](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-core-lint.json), [repository lint](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-all-lint.json), [typecheck](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-core-typecheck.log), [tests](/Users/workgyver/Developer/nyte/output/core-quality-audit-2026-09-04/evidence/nyte-core-test.log). Reproduction files run with `node <absolute-file-path>` against this checkout. Provider streams in those reproductions are local deterministic fixtures, not live API calls.
