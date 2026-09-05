# Core, TUI, and desktop cleanup

Completed the stale-file cleanup and ten-agent `typeof`/assertion review. Existing user work, session databases, credentials, and deployment configuration were preserved.

## Removed

68 stale files, listed in [removed-files.json](output/style-audit/removed-files.json):

- Core's obsolete `src/harness/`, `src/sdk/`, and `src/views/` implementations, plus the unused MCP module and tests for the replaced Uji SDK.
- TUI's unused Uji host, presenter, title and notification handlers, duplicate completion and ephemeral implementations, unused composer markers and semantics, and the replaced usage panel.
- Legacy TUI QA/sandbox drivers, tests tied to removed APIs, and the screen-capture script that depended on that driver.
- `.codex-refs/`, the completed design scratch folder with no consumers.

Root and package `.nyte` folders contain session data and remain. `.vercel` contains deployment configuration/environment data and remains.

## Coverage preserved

| Removed implementation or suite                 | Current coverage checked                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Uji SDK, tree navigation, retry harness         | Core `test/kernel/sdk*.test.ts`, `step.test.ts`, `turn.test.ts`, compaction/navigation and provider-compaction tests      |
| Legacy core projections and progress events     | Core `test/kernel/views.test.ts`, `sdk-events.test.ts`                                                                    |
| Old TUI host, print, usage collection, QA flows | TUI host, session-state, transcript-view, question-flow, model-picker, shell-interaction and interactive-compaction tests |
| Old TUI notifications                           | Plugin notification tests and current plugin composition in TUI host tests                                                |
| Old theme resolver                              | TUI `test/theme.test.ts`                                                                                                  |

Kept and repaired the supported workspace-registry, tool-result, prompt-history, offline-boot and usage-card tests. The model picker now imports the shell's existing `EphemeralPanel` type. The old usage-panel-specific input test was removed with that unused component; current menu input ownership and Escape tests remain.

TUI's test script now runs Vitest under Bun, its production runtime. This enables OpenTUI's native FFI without changing test discovery or assertions.

## Ten-agent type review

The ten scopes were SQLite, kernel execution/views, tools/results, active test repairs, kernel SDK, core plugins, core input boundaries, TUI, desktop main/preload/shared, and desktop renderer.

Concrete fixes:

- SQLite now validates persisted object shapes with schemas before checking their hashes. Removed the unchecked `as Obj`; matching hashes alone do not validate fields. Added corrupt-object/event regression tests.
- Removed a redundant `typeof` check on freshly constructed tool-result details and its wrappers. Tests cover content ordering, falsy details, and structured-error identity.
- Removed redundant hook checks, duplicate string guards, unnecessary import aliases and avoidable assertions.
- Desktop imports the protocol owner's `sessionId` constructor directly; the `asSessionId` re-export chain is removed.
- Removed provider-error parsing casts and added nested/malformed JSON coverage.

The remaining runtime `typeof` checks validate unknown JSON, tool arguments, persisted facts/settings, filesystem errors, dynamic plugin exports, or browser/Objective-C values. Checks distinguishing supported string/object or number/function unions are also valid. Type-position `typeof` and `as const` preserve inference and are not unchecked shape casts.

The centralized preload IPC assertion remains. Main owns the typed response contract, and preload verifies the echoed request path. Duplicating every response schema solely to remove that assertion would add a second contract.

## Deletion review and client alignment

Removed the remaining `waitInput`, local run-state predicates, desktop `run-state.ts`, and session-ID aliases. Run phase conditions are inline at their callers. The proposed shared `isRunActive` module and every export were removed after review; its type predicate was unsound for defined terminal runs.

Fixed three supported behaviors:

- TUI keeps core's resolved `snapshot.config`, including the recorded model when reopening a conversation with different reader defaults. Live configuration refreshes preserve streamed text and use core's active-run/idle projection. A gated real-store test covers a config change during a run and after settlement; a rendered test checks the displayed model.
- Print mode records explicit model and effort choices in one core configure call. Cancellation before configuration or while that call completes prevents prompt submission. Both cases have real-store regression tests.
- Desktop clears workspace search queries during transitions. A real host/cache regression checks the same search in the first workspace, the second, then the first again. The production UI smoke exercises that same sequence.

```text
core sessions.snapshot().config
├── TUI model and effort display
└── desktop session snapshot cache
```

Updated obsolete source paths in third-party notices while retaining attribution and licenses. No session storage migration was removed.

## Redundant-check follow-up

Traced downstream checks to their callers and core outcomes. Removed duplicates in eight code files:

- TUI branch navigation now consumes core's `heads.move` busy outcome instead of checking run activity again immediately before the call. The local compaction check remains because TUI owns that operation.
- Desktop `LiveTurn` uses the parent's `working` value. `WorkGroupView` uses the supplied `running` value and tool presentation state; neither recalculates the same live-overlay state.
- TUI task status classifies the phase once, task duration reuses that status, and transcript rendering trusts its already computed `running` condition.
- TUI model lookup and user-message lookup trust the narrowing already established by `.find`.
- Core `runs.reply` projects `outcome.kind` directly instead of repeating each identical outcome in a switch.

No active-run field, helper, or protocol layer was added. Core's remaining lifecycle guards are not duplicates of lower-level checks: completed run records remain stored; waiting runs release their lease; the kernel's head move does not enforce the SDK's active-run refusal. Removing those guards would change supported behavior. Evidence includes core `test/kernel/step.test.ts` for terminal retention and waiting without a lease, and the existing SDK navigation, cancellation, and question/reply suites.

## Verification

The scoped commands were run before and after this follow-up:

```sh
pnpm --no-bail --filter @nyte-ai/core --filter @nyte-ai/tui --filter @nyte-ai/desktop test
pnpm --no-bail --filter @nyte-ai/core --filter @nyte-ai/tui --filter @nyte-ai/desktop typecheck
pnpm --dir packages/desktop build
```

The earlier alignment pass went from core 210 tests, TUI 81, desktop 103 to core 210, TUI 86, desktop 104. The current redundant-check pass starts and finishes at core 210, TUI 88, desktop 104: **402 tests pass**, with all three typechecks passing. The two additional TUI tests came from concurrent QA work and were included in the current baseline.

`pnpm test` passes all nine workspace tasks and `pnpm typecheck` passes all twelve tasks. The earlier concurrent QA fixture diagnostics have been fixed in that work. Desktop production build and startup bundle checks pass; the existing bundle-size warning remains.

Real isolated TUI PTY checks cover startup, `/usage`, scrolling, command-menu navigation, narrow/wide resize, Escape and `/quit`; exit status 0. See [terminal smoke](output/style-audit/core-first-terminal-smoke.txt). A separate real PTY model check exercised Ctrl+P switching between two local models, preserved the selected footer through `/usage`, command-menu navigation and resize, and exited with status 0. See [model keyboard smoke](output/style-audit/core-first-model-terminal-smoke.json). TUI config behavior also has real rendered and gated-provider coverage.

The production Electron build was launched with isolated `NYTE_HOME` and app data. Cmd+K searched the same term across first → second → first workspaces and showed the correct session each time. Escape closed the palette; narrow/wide resize passed, with no renderer errors or provider requests. Screenshots: [first workspace](output/style-audit/desktop-search-first.png), [second workspace](output/style-audit/desktop-search-second.png).

The current pass also exercised `/edit` and busy queue navigation in real terminals with short and long transcripts: [branch navigation](output/style-audit/lifecycle-tree-terminal/results.json), [busy navigation](output/style-audit/lifecycle-busy-terminal/results.json). A second production Electron smoke used core's real SQLite objects, refs, and events in an isolated temporary workspace. Respond and tool phases showed working indicators and expanded details; completion cleared `aria-busy`, collapsed the work group, and displayed the final answer. Manual expand/collapse and narrow/wide resize passed. No provider calls or renderer errors. Screenshots: [respond](output/style-audit/desktop-lifecycle-respond.png), [tools](output/style-audit/desktop-lifecycle-tools.png), [done](output/style-audit/desktop-lifecycle-done.png). The process log includes an Electron sandbox-extension warning; rendering and assertions passed.

All eight changed code files pass lint and formatting. Package-wide lint retains the previously recorded 105 boundary/union findings (79 `no-runtime-typeof`, 26 `no-unknown-parameters`). No lint rules, types, assertions, or test discovery were weakened by this cleanup. The refreshed [lint inventory](output/style-audit/lint-violations.csv) records current locations and messages. Workspace-wide `pnpm lint` and `pnpm format` still report existing source and generated-artifact issues outside this pass; the latest format run reports 42 files.

Before/after logs and production smoke evidence are in `output/style-audit/redundant-checks-*` and `output/style-audit/core-first-*`. Earlier logs retain the original baseline failures: 197 core and 141 TUI typecheck diagnostics, stale suite imports, mixed test runners, and Node's missing OpenTUI FFI. The current check-only deletions add no new tests; existing behavior suites and interactive checks cover them.

## Remaining behavior boundaries

- TUI `src/usage.ts:233` and `:244` treat any run without a lease as interrupted. Core intentionally releases the lease when a question parks a run (`test/kernel/step.test.ts:365–367`), so `/usage` mislabels normal waiting runs. This existing behavior defect was found during the recursive check review and remains unfixed; it needs a status-presentation change, not deletion of the lease field.
- TUI print bootstrap still installs signal handlers after host setup, and print cancellation uses exit code 130 for SIGTERM as well as SIGINT. The fixed configure/send cancellation gap is covered; early-bootstrap signal handling remains a separate lifecycle issue.
- Desktop intentionally copies workspace-local history into its global store once; TUI still uses the workspace store. Later histories can diverge. Existing tests require the desktop import behavior. Aligning storage needs a deliberate migration policy; this cleanup did not merge or delete histories.
