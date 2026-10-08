# Test audit

2026-10-07. Final. Every author and reviewer has stopped. The suite is not all green. 2 app tests fail, as they did before this work, and several gaps remain open (see "What stays open").

The work started at HEAD `9be7ca88`. While it ran, another agent committed `dfd833df` ("feat(core)!: sessions reload their own plugins from the trust answer", 29 files), and HEAD is now at that commit. These results describe the worktree as it was when the tests ran, not a clean commit. The scope agents changed no source files.

This report covers two passes over a dirty worktree. None of their changes is committed.

1. The second pass, described first, reviewed every assertion in the 317 test files of the baseline inventory. It cut tests that restate values, check mocks, or compare code to itself, and it rewrote weak assertions into checks of real output.
2. The first pass added the web workspace journey, fixed the focus bug that journey found, and added a CI job for it. Its record starts at "First pass: the workspace journey".

## Second pass: test cleanup

### Summary

Desktop main process (`packages/desktop`). All 39 files were reviewed and 10 were edited. Cases went from 145 to 143 and lines from 5,413 to 5,396 (-17), and all 143 cases in the edited files pass. Few tests were cut, because most of these tests are real IPC, lease, relay and process-boundary checks. The changes that matter are assertions that could not fail before:

- The Windows shell-environment case passed even with the `win32` guard removed. The desktop report checked this with two scripts in `/tmp/nyte-prune-desktop/mut/`: the old input could not fail, and the new one fails without the guard.
- The Cmd+W test proved only a label. It now invokes the menu callback and asserts `{kind: "action", action: "close-tab"}`.
- The update-packaging test passed on any crash. It now requires stderr to name `NYTE_SPARKLE_PUBLIC_KEY`.
- The browser-report test matched prompt copy. It now checks that a hostile element name renders as one escaped line.
- Two approve-after-cancel blocks in host-login were dropped because they could not fail.

Splitting `connect-interop` into a journey was measured and rejected. Tests 1, 2, 4 and 5 take about 2.5 s of a 28.9 s file. Chaining them would save 1 to 1.5 s and hide later failures behind earlier ones.

Renderer (`packages/app`). All 91 files plus 21 support files were reviewed. 18 cases were cut and the edited files lost 296 lines. Two baseline failures were stale test fixtures and now pass with every assertion kept. `account-footer` gained the bridge that the component has read since `9b9d837a`, and `changes-commit` accepts the `menuitemradio` role that the dirty commit bar renders. The parent's full app run had 248 cases: 246 passed and 2 failed (`icons` and `models-settings-login`, both suspected to come from the dirty `packages/ui` work). The run covered 62 files, took 59.99 s with 2 workers, and its log is `/tmp/nyte-prune-main/app-final.log`. Most of the cut app tests asserted TanStack Query behavior through one-line pass-through query functions, so they tested the library, not the app.

The rest of the repository:

- core and host lost 11 cases and 411 lines.
- ai and plugin lost 4 cases and 702 lines. Most of the line cut comes from folding 11 copy-pasted `MockWebSocket` classes into one helper.
- The service packages lost 27 cases and 284 lines and fixed the `serve` baseline failure.
- The TUI's 78 unit cases and 10 QA cases became 2 scenarios with 21 steps, and both pass. The old effort failure turned out to be a test bug. The child-agent stop and the other gaps listed under "TUI: two scenarios" are not covered.

Outside the TUI and the approved D3 desktop test setup, this pass changed no product code, config, script or CI file. D3 adds a desktop test setup file and its vitest config entry, so tests no longer read the real home directory. The TUI redesign changed several files on purpose:

- TUI config: `bunfig.toml` deleted, and the `test` script in `package.json` drops `bun test src`.
- TUI docs: `AGENTS.md` and `qa/README.md`.
- CI: `ci.yml` installs ripgrep, because the offline QA binary would otherwise try to download it.

The redesign changed no TUI product source. No test was skipped, excluded or given a longer timeout.

In the latest package runs, every package passes except for 2 app failures, which were failing before this pass. The host's 2 failures from before this pass are fixed on disk, and host now passes 287 of 287 (see "Final verification"). No suite speedup was measured. The run durations come from a different machine load than the first pass, so they can't be compared.

### Final numbers

Cases removed by the second pass:

| Part | Before | After | Removed |
|---|---|---|---|
| Not the TUI | | | 61: the prune removed 62, and the cross-reviews added 1 (the DNS-rebinding test in server `node.test.ts`) |
| TUI | 78 unit cases + 10 QA cases = 88 | 2 scenarios with 21 steps | 86 |
| **Total** | | | **147** |

- The TUI rows can't be compared one for one, and "TUI: two scenarios" lists what is no longer covered.
- Every cross-review fix other than F2 changed assertions inside existing cases: P1, P2, F1, F3 to F5, the outbox row order, the two host fixtures, T1 and T2.
- Not counted:
  - the first pass's net -6, where 7 cases became 1 web journey;
  - 3 core cases that external work added to `activation-state.test.ts`.

Lines and declarations. I recounted the 317 baseline paths at the end, using the inventory's own counting rules:

- **Whole inventory.** 88,431 lines became 84,338 (-4,093), and 2,097 `test`/`it` declarations became 1,989 (-108). 307 of the 317 paths still exist.
- **Other agents' edits are in that total.** They added +221 lines and +4 declarations: `activation-state` +136, `session-configuration` +56, `host.test.ts` +16, `delegation.test.ts` +13 and `background-jobs` +10, less 10 lines in two small app edits.
- **This work's own change is therefore -4,314 lines and -112 declarations.** By source:
  - the non-TUI prune, -1,620;
  - the cross-review fixes, +76;
  - the deleted TUI test files, -2,770.
- **Support files outside the name pattern:**
  - TUI `qa/`, 4,884 to 3,075;
  - telemetry `conformance.ts`, -43;
  - app fixtures, -47;
  - the D3 setup file, +49;
  - the desktop vitest config, +3.

These are counts of test code. They say nothing about speed. No speedup was measured.

Product source. Across both passes the only product change is the first pass's `composedPath` fix in `app/src/screens/thread.tsx`. The second pass, the cross-reviews and the TUI redesign changed no product source. Non-product changes outside test files:

- the TUI redesign's config, scripts, docs and CI ripgrep step;
- the D3 desktop test setup file and its vitest config entry.

### What stays open

- **Two app failures**, both failing before this work: `icons.electron.test.ts` and `models-settings-login.electron.test.ts`. The dirty `packages/ui` is the suspect.
- **The subdirectory commit bug, D1.** It was a real product bug, now fixed in `host/src/git.ts` with a regression test in `host/test/git.test.ts` (see below).
- **TUI gaps.** These include the child-agent stop, local-shell process-tree kills, keymap selection and copy, and timeline internals (see "TUI: two scenarios"). No person has watched `--show` yet.
- **`connect-interop.test.ts`** leaves one temporary folder per run, which holds only wrangler's log.
- **Root checks are out of scope.** Root `pnpm typecheck`, `lint` and `format` cover the docs site and other agents' dirty work. The app `tsc -p e2e` check still fails at another agent's `e2e/server/start.ts:139`.
- **Later edits by other agents.** After the final app run, other agents edited app test files that none of these scopes own: `session-configuration`, `animated-number.test`, `style-order`, `models-settings-login`, `composer-latency`, plus `test/renderer.ts` and `vitest.config.ts`. The app result describes the tree as it was when the run happened.

### Production bug found during cross-review (fixed)

The host cross-review (`/tmp/nyte-cross-review-host/REPORT.md`, finding D1) found a real bug in `host/src/git.ts:1046` `commitPaths`. It affects workspaces that are a subdirectory of a repository, for example a monorepo package opened as the folder. Desktop calls `commitPaths` with the workspace cwd (`desktop/src/main/host.ts:970`). The bug:

- Committing `paths: ["inside.txt"]` answers `committed`, but the commit adds a stray root-level `inside.txt` and leaves `sub/inside.txt` unchanged.
- Committing `paths: ["sub/inside.txt"]`, the root-relative form the snapshot reports, answers `nothing_to_commit`.

The cause is a path mismatch. The `ls-files` and `update-index --force-remove` pathspecs resolve relative to the cwd, but the `--index-info` paths are relative to the repository root.

The reproducer is `git-subdir-legit.mts`, and I read its output in `proof-git-subdir-legit.log`. The report also proposes a host git test for a workspace at `sub/`, which fails today on both assertions, and a fix: run the plumbing at `rev-parse --show-toplevel`, and refuse paths outside `--show-prefix`.

This bug was not caused by the prune, and no coverage of it was lost. No test ever reached a subdirectory workspace. The product fix landed after the prune: `createGitVcs` resolves `rev-parse --show-toplevel` once at its boundary and runs every repository operation (snapshot, diff, contents, stage, discard, commit, log, refs, branch, push) there, so the paths git reports and the paths it is handed agree. Tree snapshots keep the workspace cwd. The `--show-prefix` guard was not adopted: Nyte's Changes view is repo-wide on purpose. `host/test/git.test.ts` "workspace opened at a repository subfolder" covers snapshot, diff, contents, stage, the selected-path commit, the wrong cwd-relative path, and both trash routes.

The finding also weakens one of this pass's own rewrites. `host/test/git.test.ts` "refuses a path outside the workspace" passes only because git itself rejects a path outside the repository. Nyte has no workspace guard of its own, so the test can't fail for a Nyte defect (finding D2).

### Cross-review corrections

The three adversarial cross-reviews are all in:

- `/tmp/nyte-cross-review-core/REPORT.md`
- `/tmp/nyte-cross-review-protocol/REPORT.md`
- `/tmp/nyte-cross-review-host/REPORT.md`

The reviewers checked "still covered" claims by mutating isolated copies of the source, not by trusting the scope reports. They confirmed most cuts. Two claims in this report's sources were wrong, and the reviews found coverage gaps that the prune either caused or carried forward.

Corrections to earlier claims:

- **The serve PR argv cut was not safe.** The service report, and this report after it, said the argv assertion repeated host's `github.test.ts`. The core reviewer mutated `serve/src/host.ts:225-226` to drop `draft`, and the pruned test still passed (`mut-serve-draft.log`). Host's test calls host directly and never crosses the client, server and serve layers. Fix P1, now applied, adds title and `--draft` assertions to the existing serve case, so no case is added. The protocol reviewer had called this cut a duplicate, and the mutation settles it the other way.
- **The abort-idempotency claim was false.** The core report said `runs.abort` idempotency "lives in runner.ts" and is covered by `sdk.test` and `background-jobs`. Those tests cover only an abort after the run ends. A repeated abort while one is still pending was never covered. With `runner.ts:783-787` mutated, all 158 tests in the 12 abort-related core files pass (`mut-R1-wide.log`). The deleted `step` test was worthless anyway, since it drove the test's own `flagAbort` helper. So the deletion stands, and the gap existed before the prune. Fix P2, now applied, adds a second abort while pending to the existing `sdk-admission` case.

P1 and P2 are applied, and the core reviewer has stopped. I read the applied logs in `/tmp/nyte-cross-review-core/`:

- serve `environment.test.ts`: 4 of 4 passed.
- `sdk-admission.test.ts`: 12 of 12 on the default store and 12 of 12 on the worker store.
- `tsc --noEmit` for core and serve: both clean.
- `oxfmt`: clean.
- `oxlint`: 0 errors and 63 warnings. The reviewer reports none of the warnings on the changed lines.

The mutation proofs fail as they should: `patch-serve-mut.log` and `patch-abort-mut.log`. Case counts are unchanged: core default 587, worker 76, serve 11.

Gaps found by the protocol review. All are applied:

| # | Where | Gap | Fix |
|---|---|---|---|
| F1 | `client/test/client.test.ts` | After the prune, the client suite catches none of the three `NyteWireError` mappings: call envelope, watch refusal and error frame. Mutants of each pass 20 of 20, and only server's wire tests catch them. The prune also left `:444` as an absence-only test, because its positive control was deleted. | Fold the three controls into existing cases. No case is added. |
| F2 | `server/test/node.test.ts` | `serve()` pins the request origin to the bound address, which defends against DNS rebinding. The deleted node test never covered this: its `Origin` with `Host: 127.0.0.1` returns 403 either way. No test sent a mismatched `Host`. | One new node test: a rebound `Host` with a matching foreign `Origin` gets 403, and the same-origin control gets 200. |
| F3 | `server/test/wire.test.ts:1016` | The heartbeat test, which the prune cited as remaining coverage, passes with `heartbeatMs: 0`. | One assertion that a `: keepalive` comment arrives on the raw stream |
| F4 | `connect/test/relay.test.ts:99-131` | The `parseDesktopFrame` refusal rows have no positive siblings. A narrowed-schema mutant passes 42 of 42. This contradicts the service report's "all have positive controls". | Replace a `toBeDefined()` with 4 literal frames that must parse |
| F5 | `connect/test/signing.test.ts:167` | The enrollment-lifetime refusal accepts any error. | Match "Token lifetime exceeds the contract" |

Also from the core review:

- The other core and host cuts were confirmed, by mutation where a branch existed and by reading the code otherwise.
- Attribution. Some hunks in `core/test/kernel/delegation.test.ts` came from the in-flight in-order-send work, not the prune: the `peer()` fixture and the keyed-receipt race moved to a second host. Commit them with that work. The file was 1,245 lines at my 01:56 count, the figure the prune reports, and is 1,258 lines now. The prune's figure stays.
- Open questions for owners:
  - `gc.collect` has no product caller.
  - Neither host git nor tree-snapshot has its own containment check. They rely on git refusing `../` (see D2).

The protocol package's 20 tests stay. They check rules that exist only at runtime, such as absent keys on open variants, `NonZeroInteger` and `minimum: 0`. TypeScript can't catch the loss of any of these, so they aren't type pins.

The protocol reviewer applied F1 to F5 to test files only. Each fix catches a mutant that passed before:

- the three client error-mapping mutants;
- removing `origin: address` from `serve()`;
- a heartbeat that sends empty bytes;
- a narrowed `DesktopFrame` schema;
- a removed lifetime check.

The full suites pass: protocol 20, client 57, connect 80 and server 51 (`/tmp/nyte-cross-review-protocol/after/`, which I read). Typecheck passes in all four packages and format is clean. Lint shows no warnings on the changed lines.

Net effect: one new test (F2, server node 6 to 7). Everything else changes assertions inside existing cases, so this pass now removes 61 non-TUI cases instead of 62.

#### Outbox row order: resolved

The protocol reviewer first said `outbox.test.ts:370` covered the outbox's row sort, then corrected it. In that test, insertion order equals time order. A mutant that removes `.sort((a, b) => a.at - b.at)` (`client/src/outbox.ts:160`) passed 13 of 13, against both HEAD and the pruned file. So the row sort was never tested, before or after the prune. The prune lost nothing here, and it didn't add the gap.

Two different properties are involved:

- Rendered row order: `rows()` sorted by `at`.
- Send order: the `sentKeys()` assertions at `:156`, `:259`, `:261` and `:373`, which were always covered.

The approved follow-up changed 4 lines of the existing `activate` case. The stored record now has `at: 2_000`, and the live submission gets the harness clock's `1_000`. So activation inserts the rows opposite to their time order, and the expected order is the literal `["key-1", "stored"]`. The send-order check is unchanged. The no-sort mutant now fails 1 of 13. The outbox file passes 13 of 13 and client passes 57 of 57, typecheck passes including `tsconfig.test.json`, and the case count didn't change. Evidence is in "Outbox row-order fixture" in the protocol report and `after/client.log`.

### Scope reports

All six `reviewed-files.json` files are complete. Together they cover all 317 baseline paths, with none missing. One path has two rows: `packages/core/benchmark/smoke.test.ts`. The service agent edited it, and the core agent saw it change mid-task and marked it blocked-dirty. The appendix uses the service agent's trim row.

| Scope | Report | Baseline files | Edited | Executed cases in edited files | Test LOC in edited files |
|---|---|---|---|---|---|
| desktop | `/tmp/nyte-prune-desktop/report.md` | 39 | 10 | 145 to 143 | 5,413 to 5,396 |
| app | `/tmp/nyte-prune-app/REPORT.md` | 91 | 15, plus 2 support fixtures | 74 to 56 | 2,424 to 2,128 |
| core, host | `/tmp/nyte-prune-corehost/TEST-PRUNE-core-host.md` | 83, including the shared benchmark row | 16 | 249 to 238 | 9,500 to 9,089 |
| ai, plugin | `/tmp/nyte-prune-ai-plugin/report.md` | 50 | 13 | 198 to 194 | 7,088 to 6,386 |
| services and root | `/tmp/nyte-prune-svc/REPORT.md` | 46 | 18, plus `telemetry/test/conformance.ts` | 288 to 261 | 6,090 to 5,806 |
| tui, redesigned | `/tmp/nyte-prune-tui/REPORT.md` (prune), `/tmp/nyte-tui-two-scenarios/REPORT.md` (redesign) | 9 | 9 deleted | 78 unit cases and 10 QA cases became 2 scenarios with 21 steps | Test files: 2,770 baseline lines deleted. `qa/`: 4,884 to 3,075. |
| **Total, without the TUI** | | **308** | | **-62 cases** | **-1,710 lines** |

The line totals come from the scope reports and predate the cross-review edits, which added some lines back. For example, the protocol fixes were +109 and -34.

The appendix totals by disposition: 222 keep, 42 trim, 30 rewrite, 13 blocked-dirty and 10 delete. All 9 TUI test files are counted under delete. `host/test/host.test.ts` moved from blocked-dirty to rewrite after the cross-review fixed its fixtures. "Edited" counts only files the scope agents changed. The pre-existing dirty files were reviewed but not edited, and several of them carry other agents' changes.

These numbers come from the scope reports. I checked them against the logs and JSON each report cites, and the before and after case counts match every row above. I also recounted lines over the 317 paths. Before the TUI redesign, the line deltas of the scope-edited files summed to the reported -1,918, which includes the TUI's interim -208. Desktop shows -17 in both counts. The parent's `/tmp/nyte-prune-main/review-owned-delta.json` lists the same per-file deltas. The final package runs below show the same case changes, package by package.

Files: 10 of the 317 baseline paths are deleted. `app/src/mention-files.test.ts` was trimmed in the first pass and deleted in this one. The other 9 are the TUI test files, which the redesign deleted (I checked the disk). One support file outside the name pattern is also deleted: `app/test/scope-performance.fixture.ts`, which nothing imports.

Executed case counts can't be compared with declaration counts. A declaration inside `it.each` or a shared suite runs several times. For example, `telemetry/test/conformance.ts` runs once for memory and once for otel, so cutting 4 declarations removed 8 executions.

### Value pins and literal outputs

The rule comes from the principles review: a test should call the code with an input and assert the literal result. A value pin is different, because it restates a value someone typed into the source.

- **Value pins were removed.** These restate a constant, table row, prompt or design token, and they fail only when someone edits that value. Examples: `maxTokens === 64` (rename, restating `MAX_OUTPUT_TOKENS`), the palette label list, five `toolStatus` switch rows, `blur(12px)`, prompt fragments in browser-report and `context-files`, and the mobile copy tables.
- **Literal outputs were kept or added.** These are values the code computes from an input. Examples: the exact cost `0.000272` from catalog pricing, the exact truncated error body, `{kind: "action", action: "close-tab"}` after invoking the menu callback, and the Durable Object names `["a/b","c"]` and `["a","b/c"]`, which also prove a forged `?tenant=` is ignored.
- **Self-referential and fixture-only checks were removed.** Examples: `keyThumbprint(k) === keyThumbprint({...k})`, which passes if the function returns `undefined`, a colour built from the same tokens the component uses, `builtinTools()` names read from the test's own helper, and a `job.phase.kind` read from a fixture nothing changes.
- **Constants became mechanism checks.** Where a value matters, the test now checks that the code delivers it. The Copilot version headers compare against the exported constants, so dropping the `X-GitHub-Api-Version` header fails 3 cases. A wrong value in the constant itself would no longer fail, and that is intended.

Four rewrites loosened a literal that is visible outside the code. Each one follows the rule, but a reviewer should agree with it:

- `connect/test/relay.test.ts` no longer checks the text "This Mac is not connected". That text is a row of the refusal table at `relay.ts:332`. Status 503 and the `{ok: false, error: {code: "closed"}}` envelope stay literal.
- `desktop/test/update-packaging.test.ts` no longer names "Nyte" and "Nyte Update Test". It requires every installer name to equal one plain product name, and the local build's name to differ from production. The desktop report says `mut/names.mts` shows the relation still catches the original `@scope` executable bug.
- `serve/test/environment.test.ts` asserts `defaults.model` instead of deep-equaling host's whole `defaults` object. The old form failed when host added `fast: false` in `fd6bf260`. The same edit also removed the PR argv check. That removal was wrong, and fix P1 restores the title and `--draft` assertions (see "Cross-review corrections").
- The Copilot version strings are covered by the mechanism check above.

### How the cases were removed

This section covers the 72 cases from the prune, including the TUI's interim 10. The redesign then deleted the TUI's remaining unit tests. All 72 are real removals. In every one, the removed test either repeats a check a kept test makes, or could not fail. The reports name where each check still lives. The cross-reviews found that this was not always enough. The client cuts left the wire-error mapping tested only in server, and the serve argv trim lost the `draft` field. Both are being restored inside existing cases (see "Cross-review corrections"). The removals took these forms:

- **Plain duplicates, deleted.** This is most of them. Examples: `step:1330` (acceptance-concurrency covers a superset), the three `oauth-device-code` cases (the Codex and Copilot OAuth tests cover them, and mutation probes confirmed it), and `tui/src/composer-mentions.test.ts` (a copy of a host test).
- **Duplicates whose few unique assertions were moved first.** Before deleting the duplicate, the agent moved its unique assertions into the test that stays, so no check was lost. Core's one-Session authorization race (`delegation:1248`) gave its continuation-run count and root to acceptance-delegation's two-connection race. In the TUI, the copyOnSelect case and the missing-account-filter case folded into kept tests, and the parent reviewed both.
- **Moved rows, net 0.** The broker-origin refusal matrix moved from `mobile/test/account.test.ts` to `connect/test/client.test.ts`, which gained one row (15 to 16). Mobile lost the case, and the check is the same.
- **Redundant parameter rows.** The connect-worker relay journey ran once per web origin and now runs once (-2). The preflight tests still accept each origin through the same `origins.includes`. Elsewhere: 3 rows of the app GitHub recovery matrix that ran one path, the desktop app-menu `win32` row (same branch as linux), and duplicate app usage-query rows.
- **Shared-suite counting.** `telemetry/test/conformance.ts` runs once for memory and once for otel, so 4 deleted declarations removed 8 executions.

Many edits removed assertions without changing the case count. The appendix lists them.

The agents checked their "still covered by" claims. They mutated throwaway copies of the source and confirmed the retained test fails: ai-plugin in `mut/` and `mut2/`, core in `mut/jobs-noop*.log`, desktop in `mut/*.mts`. I read the core logs: the original test passes under the mutation, and the rewrite fails with `expected [ { kind: 'command', … } ] to deeply equal []`. The desktop probes are scripts with no saved output, so for those I rely on the report. A probe counts only when an assertion fails on the defect. A compile error or a timeout doesn't count. The ai-plugin report says its `--testTimeout=3000` makes the 3 s Copilot lifetime test time out during probes, and it doesn't count that timeout as a catch.

### Assertions that got stronger

| File | Before | After |
|---|---|---|
| `core/test/jobs-recovery.test.ts` | Absence-only. It passed with `interruptOwned` removed. | Calls `recover()` first, so the same mutation fails it. |
| `host/test/git.test.ts` | Outside-path refusal checked only `kind: failed` on a clean tree. | Leaves a tracked change and asserts no commit landed. The cross-review found this still can't fail for a Nyte defect, because git does the refusing. See the production bug above. |
| `host/test/tree-snapshot.test.ts` | Outside-path restore checked only `kind: failed`. | A real `../escape.txt` must survive the restore. |
| `host/test/codex-usage.test.ts`, ai and plugin `openai-compaction` | `cost > 0`, `totalTokens > 0` | Exact computed values. |
| `ai/test/openai-codex-stream.test.ts` | 9 asserts on test-only debug counters | `previous_response_id` on turn 2, sticky SSE fallback after a connect timeout, sent-socket order `[1, 2, 1]`. Each fails under a mutation. |
| `ai/test/error-body.test.ts` | Substring plus a length check | Exact output. An off-by-one slice now fails. |
| `desktop/src/main/shell-environment.test.ts` | Could not fail | Fails without the `win32` guard. |
| `desktop/src/main/host-connect.test.ts` | `assert.ok(readConnectConfig(...))` | deepEqual on the parsed config |
| `app/src/session-directory-feed.test.ts` | `ids() == []`, which a no-op passes | The literal cloud directory entry |
| `app/src/conversation/diff-separator.test.ts` | Bare `rejects.toThrow()` | Exact refusal messages |
| `app/src/workbench/changes-commit-actions.test.ts` | `length > 0` and a self-referential deepEqual | The literal withheld set |
| `cloudflare/test/routing.test.ts` | `notEqual(keys[0], keys[1])` | Literal Durable Object names |
| `client/test/outbox.test.ts` (cross-review) | Row order matched insertion order, so removing the sort passed | Rows inserted against time order, literal `["key-1", "stored"]`. The no-sort mutant fails. |
| `client`, `server`, `connect` (cross-review F1 to F5) | Wire-error mapping, DNS rebinding, heartbeat, frame siblings and lifetime refusal were untested or accepted anything | Each now fails its mutant (see "Cross-review corrections") |
| `serve`, `core sdk-admission` (cross-review P1, P2) | The PR `draft` field and a repeated pending abort were untested | Both asserted. Each fails its mutant. |

### Layers

A cut is only safe when the remaining check runs somewhere CI runs. The agents kept overlaps that test different layers:

- Unit and boundary tests use stubbed `fetch`, loopback servers and child processes. They are cheap, and they are the only place races, refusals and redaction get tested.
- In-process integration runs real `createNyte` or `createHost` with SQLite (core acceptance, host, desktop `host-*`). These were kept where they use two real store connections. A one-Session test of the same race was cut, for example the core authorization race.
- Renderer tests run in Electron Chromium with `window.nyte` stubbed. They are not E2E. Two app cuts rely on `e2e/web/workspace.spec.ts`: the mention success path and the absence of Terminal and Browser on web. That spec runs in the new `e2e-web` CI job.
- In the TUI, the timeline frame test and the PTY wheel test stayed apart, one at frame level and one in a real terminal. The redesign below replaces both layers.
- `vercel/test/sandbox.test.ts` keeps its argv assertions because the external Sandbox SDK can't run locally. The desktop `connect-interop` file stays integration against real workerd.

### Protected behavior

The agents kept these, and the cuts don't touch them: the store contract and CAS races, lease and fencing, compaction recovery, relocation safety, workspace path escapes, desktop lease, replay and offline order, relay flow control, the connect-worker claim matrix, wire refusals with positive controls, outbox crash recovery, OAuth and credential redaction, web-search consent, MCP malformed input, auth concurrency, the tunnel token leak, search XSS, and the dependency-docs path escape. The full list from the first pass is under "Protected coverage".

### Decisions and corrections

- No product API changes were made for tests. `getOpenAICodexWebSocketDebugStats` stays exported, even though no test reads it now. No injectable timeout option was added.
- A first-pass recommendation was wrong, and this pass replaces it. That pass said plugin `openai-compaction` "Codex compaction can stream beyond the former 30-second total deadline" (31 s of real time) should use fake timers or move to the ai adapter. It shouldn't do either:
  - The plugin owns the guarantee: `plugin/src/openai-compaction.ts:36-40` skips `AbortSignal.timeout(COMPACTION_TIMEOUT_MS)` for Codex. An adapter test would miss a regression that brings the deadline back.
  - Vitest fake timers don't control `AbortSignal.timeout`, so a fake-clock version would pass with the regression in place.
  - The test stays at 31 s. The 3 s Copilot code-lifetime wait in `ai/test/github-copilot-oauth.test.ts` has the same cause and also stays.
- Desktop `connect-interop` stays as separate tests (see the summary).

### Changes outside this pass

These changes are not counted above:

- Product files that changed after the 01:37 baseline, with no scope claiming them: `app/src/queries.ts` (drops the plugin-settings mutation scope), `app/src/workbench/workbench.stylex.ts`, `core/src/kernel/sdk/nyte.ts`, `ui/stylex.mjs`.
- Test files that were already dirty at the baseline and kept changing: `core/test/background-jobs.test.ts` (+10 lines), `core/test/kernel/activation-state.test.ts` (+136 lines, +3 declarations), `host/test/host.test.ts` (+16 lines).
- `dfd833df` landed on HEAD during the pass (see the top of this report). It touches files listed here as dirty from other work, including `tui/src/interactive.ts` and `protocol/src/operations.ts`. "Dirty" in this report means dirty at the 01:37 baseline.
- During the pass, a dirty `pnpm-lock.yaml` made `pnpm exec` try an install, which failed at the central-icons license preinstall. The desktop report says the attempt added 3 packages to the shared `node_modules`. The final runs used `pnpm --config.verify-deps-before-run=false` and installed nothing.

### TUI: two scenarios

At the user's request, the TUI's remaining 68 unit tests and its 10 QA cases became exactly two scenarios. Before that, an interim prune had cut 10 unit cases and 208 lines (`/tmp/nyte-prune-tui/REPORT.md`). Both scenarios run the compiled `bin/nyte` against a loopback scripted provider with an isolated `NYTE_HOME`, and neither imports product controllers. The author's report is `/tmp/nyte-tui-two-scenarios/REPORT.md`, and its "Round 2" section covers the second round.

- **headless (7 steps).** Covers:
  - `--help`
  - streaming `-p --json`
  - a bash tool run from piped stdin
  - `--session` resume
  - `--provider`, `--model` and `--effort`
  - a provider error exiting 1
  - SIGTERM during a tool exiting 143
- **tui (14 steps).** Runs OpenTUI in a real PTY and covers:
  - the trust prompt and the project plugin's command
  - key echo and streaming
  - Esc stopping a bash tool
  - paging and the wheel
  - resize
  - the model picker and Shift+Tab
  - settings
  - `/quit` with `--session` resume
  - SIGTERM

  Round 2 added four steps after the final review:
  - Step 8, effort is fixed for a run. After `/effort low`, both the first request and the tool continuation carry `low`, even though Shift+Tab sets `medium` mid-run. A Ctrl+Enter follow-up shows its queue row, is sent only after the run ends, and carries `medium`.
  - Step 9, the question tool. A picked answer reaches the provider as the tool result, with no extra user message.
  - Step 10, the local shell. `!` runs a command with no model request. Esc shows `✗ !` and ends the process. `!echo kept` sends exactly `<shell command="echo kept" exit="0">\nkept\n</shell>` with the next prompt.
  - Step 14, a new session. It shows the saved model and level, and `/effort low` before the first message reaches that request.

  Round 3, the last, tightened two steps. Step 8 now checks that no follow-up request exists while the continuation is held, as well as checking delivery after release. Step 10 checks that the prompt has exactly one `<shell ` opener. Edits to the TUI are frozen.

**Correction: the old effort failure was a test bug, not a product bug.** This report used to list `models.during-turn` as a failure the redesign dropped. The author reran the old case unchanged against the current binary, and it still fails with `'medium' !== 'low'` (`old-models-during-turn-rerun.log`). I read that run's `provider.json`:

- Request 1 is the automatic title request: `gpt-5.6-luna` with `reasoning_effort: medium`.
- Request 2 is the chat request: `nyte-qa` with `low`.

The old test's predicate `prompt === "keep working"` matched the title request first. Steps 8 and 14 now check the chat requests. No assertion was loosened to get them to pass.

**The child-agent stop is still uncovered.** `journey.long` failed at "stopping the parent leaves its awaited child working". The redesign has no step for child agents, so this behavior is neither fixed nor shown to be covered. Treat it as an open item.

What changed on disk:

- All 9 baseline TUI test files are deleted, 2,770 lines in the baseline inventory. The unit suite had 68 cases and 2,562 lines after the interim prune.
- `qa/` went from 4,884 lines to 3,075.
- `bunfig.toml` is deleted, and `bun test src` is gone from the `test` script.

Runs, from logs I read:

- The parent's final reviewed run passed 2 of 2: headless 7 of 7 and tui 14 of 14 (`/tmp/nyte-prune-main/tui-final-reviewed.log`). This is the result of record.
- The author's round-3 run passed 2 of 2 (`final3-test.log`). The 3 round-2 runs passed 2 of 2 each (`final2-test-{1,2,3}.log`).
- `--show` and `--step` in a PTY both exited 0.
- Ctrl+C at 7 s during `--show` exited 130 (`pty-ctrlc-2.log`). The author reports that the fixture was removed and no process was left, so the README's cleanup claim now holds.
- Typecheck is clean, format is clean, and lint has 1 warning that predates the redesign.
- No person has watched `--show` yet.
- The bash-grammar fetch is still refused, now 5 times per `tui` run. Removing it needs a product option or a vendored grammar.

Behavior no longer covered, from the author's coverage map:

| Old area | Not covered now |
|---|---|
| `local-shell` (12 unit cases) | Step 10 covers output as context and Esc. Not covered: separate stream decoding, cwd isolation, killing orphan and setsid descendants, output bounding and the overflow log, pre-abort, launch failure, native signal reporting, closed stdin. |
| `keymap` (21) | Selection and copy, which QA can't reach because the OS clipboard is stubbed. Late and replaced picker results. Tree loading. Usage and diagnostics panel scrolling. |
| `timeline` (20) | Turn navigation, jump frames, follow ownership while streaming, anchors through disclosure and reflow, selection across virtual windows, disjoint notice and picker rows, the bounded mounted window, tiny-size footer layout. |
| `composer` (3), `settings` (4), `plugins` (2), `tool-card` (4), `run` (2) | Special-character `<shell>` escaping and rebuilding from history. Bang recall. Clipboard NUL stripping. Scroll-acceleration policy and project overrides. Plugin setup abort and late-effect fencing. Exit, duration and failure wording. The Copilot launch fallback and signed-out `/login`. |
| QA cases | Child agents, including parent stop with children. `/tasks` cancel. Ctrl+Z backgrounding. SIGINT exit 130. A queued steer during stop. Question dismiss, revisit and typed answers. Queue edit, reorder, height cap and multi-entry order. A model change mid-run (Ctrl+P). `/reload`, hot reload and failed reload. Steer handoff. Repeated resize and focus. History Up/Down. `/theme`. The usage panel. Unicode payloads. `!!`. |

### Final verification

Status: final. Every fix is applied and verified: P1, P2, F1 to F5, the outbox row order, D3, T1, T2, and the TUI's 21-step run. Desktop was rerun on the final tree.

The rows come from runs at different times. app, core, ai, plugin, telemetry, mobile, connect-worker and the service packages come from the parent's runs before the cross-review fixes. P1 and P2 were verified in their files and don't change counts. client, connect and server come from the protocol reviewer's full runs, and host from the host reviewer's final run. Rows marked "earlier run" come from the parent's runs before the host fix.

The parent ran every non-TUI package after the authors stopped, using `pnpm --config.verify-deps-before-run=false` and 2 workers. I read the summary of each log in `/tmp/nyte-prune-main/<package>-final.log` and the exit codes in `package-exits.txt`. Each "Before" figure is the package's first-pass result, the baseline this pass started from.

| Package | Before (total, failures) | Latest: pass, fail, skip | Change | Why |
|---|---|---|---|---|
| app | 266, 4 failed (after the first-pass change) | 246, 2, 0 | -18 | App cuts. `account-footer` and `changes-commit` fixed. |
| desktop | 261, 3 failed, 2 skipped | 257, 0, 2 in 31 files, 57.84 s. The parent's run on the final tree, after every D3 edit (`desktop-final-reviewed.log`). | -2 | Desktop cuts. The 3 load-sensitive failures passed. |
| core, default store | 594, 1 failed, 1 skipped | 587, 0, 1 | -6 | -9 from core cuts, +3 from external work in `activation-state.test.ts` |
| core, worker store | 76 | 76, 0, 0 | 0 | |
| host | 289, 3 failed | 287, 0, 0 in 22 test files, after the fixture fixes, T1 and the D3 stub (`host-suite-final-summary.txt`). The earlier run had 285, 2, 0. The 45 in the summary counts describe blocks, not files. | -2 | Host cuts. `:117` and `:757` fixed in the test. `plugin-sources` passed. |
| ai | 381 | 378, 0, 0 | -3 | |
| plugin | 138, 1 failed | 137, 0, 0 | -1 | `mcp:293` passed this run. |
| client | 67 | 57, 0, 0 | -10 | |
| protocol | 20 | 20, 0, 0 | 0 | |
| telemetry | 31 | 23, 0, 0 | -8 | |
| connect | 81 | 80, 0, 0 | -1 | |
| connect-worker | 107 | 105, 0, 0 | -2 | |
| mobile | 37 | 34, 0, 0 | -3 | |
| server | 52 | 51, 0, 0 | -1 | 2 cuts, plus the F2 rebinding test |
| serve | 11, 1 failed | 11, 0, 0 | 0 | Catalog test fixed |
| cloudflare, vercel, cli, demo/server/vercel | 12, 16, 9, 9 | 12, 16, 9, 9 passed | 0 | |
| root (`dependency-docs` 6, benchmark smoke 2) | 9 | 8, 0, 0 | -1 | |
| **Non-TUI total** | **2,466, 13 failed, 3 skipped** | **2,403, 2, 3 (2,408 cases)** | **-58** | **-61 from this pass, +3 from external core work** |

The client, connect and server rows come from the protocol reviewer's full runs after F1 to F5. The case counts in the edited files haven't changed since: client 57, connect 80 and server 51. The other 10 cases this pass removed were TUI unit cases, and the redesign then replaced the whole TUI suite. The 3 skipped tests are gated by environment variables, as before: `postgres-network` and the two desktop Electron benchmarks. The first-pass totals table counted app at its baseline of 268, before the first-pass change, so it shows 2,468 cases instead of 2,466.

Two failures remain, and both were failing before this pass:

- app `icons.electron.test.ts` and `models-settings-login.electron.test.ts`. The dirty `packages/ui` is the suspect for both.

The host reviewer's fix for the two host failures is in `host.test.ts`:

- `:117`, "global idle mode…". `12306cc1` switched the default cache retention to the long tier and updated core's `cache-warming.test.ts`, but not this test. The fixture defined only the short tier (`promptCache: { short: 10.2 }`). So every tick reported "cache lifetime unavailable" (`idle-diag.log`). The fixture now defines `{ long: 10.2 }`. The value stays 10.2, so the test waits no longer.
- `:757`, "relocation asks the host's trust…". An empty destination no longer needs trust. The fix writes the real project plugins before relocating, so the test still asserts the `workspace_trust` requirement, then trusts the destination and relocates.

The full host run after the fix passed 287 of 287. I read `host-suite-after.json`.

The host review also led to these changes, applied to test infrastructure only (`/tmp/nyte-cross-review-host/REPORT.md` section 6):

- **D3, tests no longer read the real home directory.** The desktop fixtures and `host/test/plugins.test.ts` stubbed `NYTE_HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`, but not `HOME`. So `workspaceStorePath(homedir())` copied the developer's real `~/.nyte/sessions.db` into the test root, and the real `~/.agents/skills` and `~/.claude/skills` became catalog input. `proof-home-leak.log` shows a 24,576-byte copy and both skill folders. Two fixes:
  - **Desktop.** A new setup file, `desktop/src/main/fixtures/isolated-home.ts`, is registered in `desktop/vitest.config.ts`. Before any import, it points `HOME` and `USERPROFILE` at a fresh temporary path and clears the inherited `NYTE_HOME`, `NYTE_BIN_DIR`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `XDG_*`. `beforeAll` creates the folder and `afterAll` removes it. A file whose tests are all skipped creates nothing. A test's own `vi.stubEnv("HOME")` still wins.
  - **Host.** One `HOME` stub in `host/test/plugins.test.ts`, where `resolveHostPlugins({ kind: "home" })` was loading the real skills folders.

  Correction: I said earlier that two host fixtures needed a stub. Only one did. `mention-files-install.test.ts` compares a folder with `realpath(homedir())` and rejects before reading anything, so it is unchanged.

  The isolation probe passed (`proof-isolation-final.log`): the overrides are cleared, nothing is copied, both temporary homes are gone, 0 are left over, and the sentinel folder was never created.
- **The same config file also changed for another reason.** `desktop/vitest.config.ts` also lost `runtimeInjection: false` from its StyleX plugin. That edit belongs to another agent's StyleX work, which the reviewer left as found. It is not part of D3.
- **Limitation.** `connect-interop.test.ts` uses the connect-worker workerd broker, and its `close()` resolves before wrangler writes `Library/Preferences/.wrangler/logs`. So wrangler re-creates that file's temporary home after `afterAll` removes it, leaving one temporary folder per run that holds only wrangler's log. This is not a read of the real home. Before D3, that log went to the developer's real `~/Library/Preferences/.wrangler`. The real fix is for the connect-worker helper to wait for wrangler's log flush or set its log path, which is outside this scope. Cleanup is therefore not complete for that one file.
- **T1 and T2, two redundant asserts removed.** T1 removes `host.test.ts:407`, the builtin plugin count above 5. The test still requires `skills` to be `active`. T2 removes the `else { assert.ok(snapshot.nyteError) }` branch in `desktop/src/main/host-workspaces.test.ts`, because `:1288` already asserts the exact text.

After T1 and the plugins stub, host passed 287 of 287 in 22 files (`host-suite-final-summary.txt`). Typecheck is clean for host and desktop (`host-tsc.log`, `desktop-tsc.log`).

The review checked the earlier host and desktop deletions against the code paths and confirmed each is a duplicate. It also named two `ipcFailure` producers that were never covered, `host.ts:3241` and `:3172`. That is a gap that existed before the prune, and the prune didn't cause it.

A first-pass failure that passed in one run is not proven fixed. This applies to the desktop `connect-relay`, `host-connect:954` and `terminals` tests, core `provider-compaction:352`, host `plugin-sources` and plugin `mcp:293`.

The parent's targeted checks, which I read in `/tmp/nyte-prune-main`. They cover 90 files: the 73 from the first check list that still exist, plus the cross-review edits, the TUI QA files, and the desktop test setup and config. They replace the earlier 73-file checks.

| Check | Result |
|---|---|
| `oxfmt --check`, 90 files | Clean, exit 0 (`format-reviewed.log`) |
| `oxlint`, the 89 code files | Exit 0, with 0 errors and 1,401 warnings (`lint-reviewed.log`). 1,385 of the warnings are `require-readable-spacing`. The other 16 are `no-runtime-typeof` 5, `no-known-value-widening` 3, `no-unknown-parameters` 2, `no-module-mocking` 2, `no-conditional-empty-object-spread` 2, `no-unknown-returns` 1 and `no-array-filter-map` 1. The files are not warning-free. The file list differs from the earlier 73-file check, so the two warning counts can't be compared. |
| `git diff --check`, same files | Clean, exit 0 (`whitespace-reviewed.log`) |
| desktop `tsc --noEmit` | Passes on the final tree (`desktop-typecheck-reviewed.log`) |
| app `tsc --noEmit`, then `tsc --noEmit -p e2e` | The source check passes. The e2e check fails only at `e2e/server/start.ts:139` (`host` is not in `ServeOptions`), which comes from another agent's edit and predates this pass (`app-typecheck.log`). |
| Typecheck in the other scopes | Each scope report shows a clean scoped typecheck. Mobile is the exception: its `src/chat/composer.tsx` already failed `tsc` at the baseline. |
| `e2e/web/workspace.spec.ts` | 1 of 1 passed: 2.0 s for the test, 3.3 s for the runner. The run used `CI=1`, a fresh port 5293 and no retries (`workspace-e2e.log`). |
| Cross-review fixes | All applied:<br>- host fixtures, T1 and D3 (host 287 of 287)<br>- P1 (serve 4 of 4)<br>- P2 (`sdk-admission` 12 of 12 on both stores)<br>- F1 to F5 (protocol 20, client 57, connect 80, server 51)<br>- the outbox row order (client 57)<br>- T2 and D3 on desktop (see the desktop row) |
| TUI, `pnpm --dir packages/tui run test` | The parent's final reviewed run: 2 of 2 scenarios, 21 of 21 steps (`tui-final-reviewed.log`). The binary was built at `dfd833df`. |

Root `pnpm typecheck`, `pnpm lint` and `pnpm format` are not part of this check. They include the docs site and other dirty work unrelated to these test changes.

### Proposals not done

- Move `app/src/chrome/titlebar.electron.test.tsx` t2 to `e2e/desktop`.
- Move `desktop/src/main/{usage,workspaces}.test.ts` to `packages/host`, since they test host code. Move host-remote-access "disconnecting before a watch's first event" to serve or server.
- Move demo `dispatch` and `workflow` into `packages/vercel` with injected dependencies, and drop `vi.mock`.
- Desktop `host-server.test.ts`, which is dirty from other work: its 16 s cloud-preparation test needs an injectable deadline.
- Candidates in files that are dirty from other work, for their owners: core `sdk.test.ts` streaming-close (no assertion beyond `within()`), host `host.test.ts:193` (exact tool list) and `:373` (count above 5), plugin `openai-astra-context` matrix from 4 cases to 2, plugin `mcp` name tests.
- Casts that AGENTS.md forbids remain in `telemetry/test/otel.test.ts:15-18` and `ai/test/validation.test.ts`.
## First pass: the workspace journey

The sections from here to the appendix are the first-pass record, with second-pass notes added where an item has changed.

The first pass was a repository test audit plus one targeted implementation by agent `app`:

- the web workspace journey;
- the focus bug that journey found;
- an `NYTE_E2E_PORT` override;
- a CI job that runs only the journey.

The audit covers every package with a test script and the root unit tests. The implementation is complete in the worktree and not committed (see "Conversion").

First-pass sources are the package reports, which take precedence over the shared `/tmp/nyte-test-audit-*.log` files. Several runners shared those log names and could have overwritten each other's files.

| Scope | Report |
|---|---|
| app | `/tmp/nyte-test-audit-app.md` |
| ai, plugin, client, protocol, telemetry | `/tmp/nyte-test-audit-ai-plugin-client-protocol-telemetry.md` |
| core, host | `/tmp/nyte-audit-corehost-claude/TEST-AUDIT-core-host.md`, private logs in the same directory with `SHA256SUMS.txt` |
| desktop, tui | `/tmp/nyte-test-audit-desktop-tui.md` |
| connect through demo, plus the root tests | `/tmp/nyte-test-audit-scope-connect-to-demo.md`, private runner in `/tmp/nyte-audit-scope-connect-demo/` |

### Key finding

The new workspace journey found a real bug that the five older specs never reached.

In the browser, typing into the README editor in the Files panel sent the text to the Message composer. The cause is in `TypeToCompose` in `packages/app/src/screens/thread.tsx`. It decides whether a key already has an owner by calling `document.activeElement.closest(KEY_OWNERS)`. The file editor sits inside a shadow root, so `activeElement` returns the shadow host and `closest` never reaches the editor. HEAD has this code at line 1139, and `thread.tsx` was clean when the audit started.

The fix, which stays in the worktree, checks `event.composedPath()` instead. That path includes the element that actually received the key.

| Run | Log | Result |
|---|---|---|
| Journey before the fix | `/tmp/nyte-e2e-workspace-before-fix.log` | 1 failed. `expect(editor).toBeFocused()` got "inactive" after `keyboard.type`. Test 5.6 s, 8 s wall. |
| Journey after the fix | `/tmp/nyte-e2e-workspace-after-fix.log` | 1 passed. Test 1.6 s, Playwright 2.8 s, 4 s wall. |
| Journey repeated 3 times, same server, 1 worker | `/tmp/nyte-e2e-workspace-repeat3.log` | 3 of 3 passed, 1.6 s each. Playwright 6.5 s, 7 s wall. |
| CI job's steps run locally (build, then the focused spec) | `/tmp/nyte-e2e-ci-steps.log` | 1 passed. Test 1.7 s, 6 s wall. |

All of these runs used `CI=1` on port 5287. I read each log and the final diff myself. They show that the bug is fixed. None of them measures a speedup of the suite.

### Qualification

These results come from a dirty worktree that kept changing while the suites ran. They do not describe HEAD.

- When the audit started, 79 paths were dirty. At the last check there were 81. Dirty paths include core `sdk/{activation,relocate,runner,session-pool}.ts`, host `src/{index,settings/store}.ts`, `tui/src/interactive.ts`, `desktop/src/main/host.ts` and parts of `packages/ui`. A plugin-reload refactor in progress removes `setPlugins`.
- During the runs, other agents changed the E2E target. `e2e/server/start.ts` went from dirty to clean and back to dirty. `sidebar.spec.ts` and `zz-debug.spec.ts` appeared and disappeared, and `workspace.spec.ts` is new. A stray root file named `timeout`, written by colliding runners, was backed up and removed by the core and host agent.
- Agents ran suites in parallel. Load averages ran from 9 to 28. Times below are contended, so don't use them as benchmarks.
- Debug `console.log("DBG …")` lines from the dirty `session-pool.ts` and `plugin/test/host.ts` appear in several logs.
- A failure is attributed to HEAD here only if a run on a clean checkout showed it. No such run exists for any failure below. Two kinds of evidence are not proof of a CPU-load root cause or of a committed bug: "failed under parallel load, passed 3 of 3 in isolation", and "the involved files are clean at HEAD".

The overall suite is not green. Most packages passed: ai, client, protocol, telemetry, the core worker-store pass, the tui unit tests, every service package except serve, and both root files. Across the rest, 13 tests failed, there was 1 unhandled error, and 9 of 10 TUI terminal QA cases failed. No baseline exists for the web E2E on port 5181. On port 5287, the original files and workbench specs failed 3 of 5, and the 6 current web tests ran 4 passed and 2 failed (see "Web E2E"). The desktop E2E never ran.

### First-pass results

These are the first-pass runs, before the second pass. For the current state, see "Final verification" above. Times are Vitest or Bun durations unless the row says otherwise.

| Suite | Files | Pass | Fail | Skip | Time | Exit |
|---|---|---|---|---|---|---|
| ai | 39 | 381 | 0 | 0 | 8.4 s | 0 |
| plugin | 11 | 137 | 1 | 0 | 45.1 s | 1 |
| client | 6 | 67 | 0 | 0 | 0.5 s | 0 |
| protocol | 2 | 20 | 0 | 0 | 0.2 s | 0 |
| telemetry | 2 | 31 | 0 | 0 | 0.1 s | 0 |
| core, default store | 59 | 592 | 1 | 1 | 19.2 s, plus 1 unhandled error | 1 |
| core, worker store, run separately because `&&` stopped it | 6 | 76 | 0 | 0 | 6.1 s | 0 |
| host | 22 | 286 | 3 | 0 | 30.7 s | 1 |
| app, unit, baseline | 63 | 264 | 4 | 0 | 51.4 s | 1 |
| app, unit, after the change (not counted in the totals) | 63 | 262 | 4 | 0 | 23.66 s, under different load | 1 |
| desktop, unit | 31 | 256 | 3 | 2 | 55.5 s | 1 |
| tui, `bun test src` | 9 | 78 | 0 | 0 | 12.1 s | |
| tui, terminal QA (`qa/run.mjs`) | 10 cases | 1 | 9 | 0 | about 70 s; 82 s wall for the whole script | 1 |
| connect | 4 | 81 | 0 | 0 | 0.5 s | 0 |
| connect-worker | 10 | 107 | 0 | 0 | 54.5 s, of which `relay.test.ts` is 52 s | 0 |
| mobile | 3 | 37 | 0 | 0 | 0.5 s | 0 |
| server | 4 | 52 | 0 | 0 | 1.4 s | 0 |
| serve | 2 | 10 | 1 | 0 | 1.1 s | 1 |
| cloudflare | 3 | 12 | 0 | 0 | 0.7 s | 0 |
| vercel | 3 | 16 | 0 | 0 | 3.1 s | 0 |
| cli | 2 | 9 | 0 | 0 | 1.9 s | 0 |
| demo/server/vercel | 3 | 9 | 0 | 0 | 2.1 s | 0 |
| root, `scripts/dependency-docs.test.mjs` | 1 | 6 | 0 | 0 | 1.9 s | 0 |
| root, `packages/core/benchmark/smoke.test.ts` | 1 | 3 | 0 | 0 | 1.0 s | 0 |
| app web E2E, all specs on 5181 | | | | | blocked | not run |
| app web E2E, `files.spec.ts` and `workbench.spec.ts` on port 5287 | 2 | 2 | 3 | 0 | 94 s wall | reported by agent `app` |
| app web E2E, `workspace.spec.ts` before the fix, port 5287 | 1 | 0 | 1 | 0 | 5.6 s test, 8 s wall | 1 |
| app web E2E, `workspace.spec.ts` after the fix, port 5287 | 1 | 1 | 0 | 0 | 1.6 s test, 4 s wall | 0 |
| app web E2E, `workspace.spec.ts` repeated 3 times, port 5287 | 1 | 3 | 0 | 0 | 6.5 s, 7 s wall | 0 |
| app web E2E, all 6 tests, default local environment, port 5287 | 3 | 4 | 2 | 0 | 15.0 s, 15 s wall | 1 |
| app web E2E, all 6 tests, build without account sign-in (as in CI), port 5287 | 3 | 5 | 1 | 0 | 9.7 s, 10 s wall | 1 |
| app web E2E, CI job steps (`workspace.spec.ts`), port 5287 | 1 | 1 | 0 | 0 | 2.9 s, 6 s wall | 0 |
| app desktop E2E | | | | | | not run |

The package commands are `pnpm --dir packages/<name> test`. The root tests run with `pnpm exec node --test <file>`.

The groups add up to the reported totals:

| Group | Pass | Fail | Skip |
|---|---|---|---|
| Providers (ai through telemetry) | 636 | 1 | 0 |
| core, both store passes | 668 | 1 | 1 |
| host | 286 | 3 | 0 |
| app | 264 | 4 | 0 |
| desktop | 256 | 3 | 2 |
| tui, unit only | 78 | 0 | 0 |
| Services, including the 2 root files | 342 | 1 | 0 |
| **All** | **2,530** | **13** | **3** |

Those are executed counts. The inventory found 2,097 `test`/`it` declarations in source, which is a different measure. Loops, parameterized cases, skips and the second core store pass all make the two numbers differ.

The skips:

- `core/test/postgres-network.test.ts` is gated on an environment variable.
- desktop `benchmark/browser-runtime.electron.test.ts` needs `NYTE_DESKTOP_BROWSER_E2E=1`.
- desktop `benchmark/session-status.electron.test.ts` needs `NYTE_DESKTOP_E2E=1` and a build.

### Failures

Second-pass status: the `account-footer` and `changes-commit` fixtures are fixed, with no assertion dropped. The `serve` catalog test is fixed by asserting `defaults.model` only. Plugin `mcp:293` didn't reproduce in the ai-plugin agent's baseline run. Everything else in the table stands. Cross-review update: both host failures are fixed in the test, and host passes 287 of 287. `:117` failed because the fixture defined only the short cache tier while the default now uses the long one. `:757` expected trust for an empty destination, which is no longer required. See "Final verification". The TUI QA rows below are replaced by the two-scenario suite. Correction: `models.during-turn` was a test bug. Its predicate matched the automatic title request, which carries `medium`, while the chat request carried `low`. See "TUI: two scenarios".

| Test | Symptom | Isolated rerun | What the evidence supports |
|---|---|---|---|
| `core kernel/provider-compaction.test.ts:352` | `competitor.ok` true, expected false. An unhandled `AggregateError: Compaction cleanup failed` was attributed to the next test. | 3 of 3 pass | Failed under parallel load and passed alone. The test uses a 60 ms TTL with `sleep(150)`, and its failure path never awaits `compacting`. Harden it. |
| `host test/host.test.ts:117`, global idle mode | 5 s timeout. Still hangs with a 60 s timeout. | 3 of 3 fail | The test never finishes. The dirty diff doesn't touch it. Cause not isolated. |
| `host test/host.test.ts:757`, relocation asks for trust | `relocated`, expected `requires workspace_trust` | 3 of 3 fail | Conflicts with committed `92b65059`: the empty destination needs no trust. Probably present at HEAD. Not run on a clean checkout. |
| `host test/plugin-sources.test.ts:261` | `waitFor` timed out | 3 of 3 pass | Failed under parallel load and passed alone. |
| `plugin test/mcp.test.ts:293` | 5 s timeout | not rerun | The logs show `DBG set listeners 0`, which points at the dirty `plugin/test/host.ts` `setPlugins`. Unconfirmed. |
| `app src/chrome/account-footer.test.tsx` | "No Nyte bridge is installed" | fails again | Agent `app` traces the failing read to commit `9b9d837a`. Inference until a clean HEAD run shows it. |
| `app src/workbench/changes-commit.test.ts` | "Missing menu item: Commit Changes" | fails again | The dirty `changes-commit-bar.tsx` switches to `MenuRadioItem`, and the fixture queries `role="menuitem"`. |
| `app src/chrome/models-settings-login.electron.test.ts` t1 | waits forever for the "Default model" combobox | fails again | Suspects are the dirty `ui/select.tsx` and `model-picker.tsx`. Unconfirmed. |
| `app test/icons.electron.test.ts` | "light warning:outlined ink changed" | fails again | Suspect is the dirty `packages/ui`. Unconfirmed. |
| `desktop connect-relay` "request bytes are credited…" | expected 786432 bytes of credit, got 1310720 | 45 of 45 pass for the three desktop files | Failed under parallel load and passed alone. The test compares readings taken after fixed `sleep` calls. |
| `desktop host-connect:954` "a lease that drops a device…" | 5 s timeout | same rerun | Same pattern. The test asserts a lapse of under 3 s. |
| `desktop terminals:85` "idle is true at the prompt…" | 1 s `vi.waitFor` | same rerun | Same pattern. |
| `serve test/environment.test.ts:154` | `catalog.defaults` has an extra `fast: false` | not rerun | The service report traces the field to commit `fd6bf260` at `host/src/catalog.ts:305`, and both files are clean at HEAD. Not run on a clean checkout. The test deep-equals the whole object. |
| TUI QA, 5 rendering, queue and signal cases | Every screen beat passed. Teardown failed on blocked `CONNECT pub-…r2.dev:443`. | | That host is `DEFAULT_MODELS_CATALOG_URL`, and a catalog refresh for another provider probably reaches the network. Possibly committed in `d36428be`. Not proven. |
| TUI QA `plugins.reload` | stays at `Reloading…` | | The dirty `tui/src/interactive.ts` removes the `Reloaded …` notice the case waits for. HEAD has it at line 4668. |
| TUI QA `journey.short` | no trust prompt; the screen shows "failed to download ripgrep" | | Unresolved. Overlaps the dirty activation and plugin-reload work. |
| TUI QA `journey.long` | deadline at "stopping the parent leaves its awaited child working" | | Unresolved. Every later beat was skipped. |
| TUI QA `models.during-turn` | request carried `medium` after `/effort low` | | Unresolved. Overlaps the dirty `runner.ts`. |

The HEAD-binary TUI comparison (`tui-head-binary.log`) was inconclusive. That copy was installed with `--ignore-scripts`, and 9 of 10 cases timed out at launch.

#### Web E2E

Port 5181 was free at the first check. By the time the run started, another agent held it with repeated `playwright test --project=web` runs. With `CI=1`, Playwright won't reuse a server it didn't start, and without `CI=1` the run would test someone else's server. This audit stopped no processes, so no baseline exists on 5181.

Agent `app` then ran the five original tests in `files.spec.ts` and `workbench.spec.ts` on their own. The run used `CI=1`, `NYTE_E2E_PORT=5287`, `--retries=0` and one worker.

- Result: 2 passed, 3 failed, 94 s wall.
- The failures can't find the explorer tree. `files-panel.tsx:151` starts with `sidebarVisible` set to `false`, and these older tests never press Show Explorer.
- Log: `/tmp/nyte-e2e-original-files-workbench.log`. At 00:55 a rerun was overwriting that log, so this report gives the result as agent `app` stated it, not as read from the file.

The original specs fail, so they are not a working baseline. The journey's times (1.6 s per run) can't be compared with their 94 s as a speedup. The old run spent most of its time waiting out timeouts on a broken flow.

All 6 current web tests ran with the same setup in two environments.

| Environment | Log | Pass | Fail | Time |
|---|---|---|---|---|
| Default local environment | `/tmp/nyte-e2e-stable-web.log` | 4 | 2 | 15.0 s |
| Build without account sign-in, as in CI | `/tmp/nyte-e2e-full-web.log` | 5 | 1 | 9.7 s |

I read both logs.

- The workspace journey passed in both, at 1.8 s and 1.6 s.
- `chat.spec.ts` "a new chat shows the reply…" failed in both. It couldn't find the `Echo: hello` sidebar button marked as the current page. Agent `app` reports that the selected chat sits hidden inside a grouped list. The service report saw the same locator fail at 00:49.
- `pairing.spec.ts` "a wrong token in the form is rejected…" failed only in the default local environment, where it couldn't find the heading "Connect to a Desktop". A `VITE_NYTE_CLERK_PUBLISHABLE_KEY`, for example from `.env.local`, turns on account sign-in, and `/` then opens the account screen. Without the key, the test passes. The updated `e2e/README.md` documents this.
- Neither `chat.spec.ts` nor `pairing.spec.ts` is part of this change. Both are unchanged, and CI doesn't run them.

To run one spec, use `pnpm --dir packages/app exec playwright test --config e2e/playwright.config.ts --project=web <spec>`, the command the CI job uses. Don't use `pnpm --dir packages/app e2e <spec>`. That script ends in `--project web`, so Playwright reads the spec paths as project names and exits with "Project(s) … not found" (`/tmp/nyte-e2e-ci-command.log`). This was already the case and needs no fix.

### Kinds of test

First-pass inventory: 318 test files with 88,443 lines and 2,097 `test`/`it` declarations. The second-pass baseline (`/tmp/nyte-prune-main/inventory-before.json`, 01:37) was taken after the first-pass change and has 317 files, 88,431 lines and 2,097 declarations. The method:

- Files are the union of `git ls-files --cached --others --exclude-standard`, deduplicated and limited to existing regular files.
- Files are kept when the name matches `\.(test|spec|browser-test|type-test)\.[cm]?[jt]sx?$`.
- Declarations match `\b(test|it)\s*(?:\.[\w]+\s*)?\(`.

The count covers unit tests, e2e and benchmark specs, browser fixtures and type tests. It leaves out support and QA files whose names don't match, such as `qa/journeys.ts` and `test/renderer.ts`.

The shares below use a different selection, files under test, e2e, qa and benchmark paths plus the same name pattern, so they do include support files. They are snapshot counts and can miss fixtures outside those paths.

Test and support code as a share of each package's tracked code, from `git ls-files`:

| Package | Test and support lines | All code | Share |
|---|---|---|---|
| app | 13,731 | 72,168 | 19.0% |
| core | 27,061 | 56,642 | 47.8% |
| desktop | 13,767 | 31,998 | 43.0% |
| tui | 7,485 | 32,018 | 23.4% |

From cheapest to most expensive, the suites contain these kinds of test:

1. Unit and boundary tests. These are most of ai, client, protocol, telemetry, connect and mobile, plus the store contract tests in core. They use stubbed `fetch` and WebSocket, loopback servers and child processes. `ai/test/openai-codex-stream.test.ts` repeats about ten `MockWebSocket` classes of about 40 lines each. One shared fixture would remove about 350 lines.
2. In-process integration. These run real `createNyte` or `createHost` with SQLite and scripted providers: most of core, host and plugin, and desktop `src/main/host-*`. `connect-worker` runs its tests in local workerd, and `desktop connect-interop` runs against a real workerd broker.
3. Renderer integration in Electron Chromium. 22 app files call `testRenderer` from `test/renderer.ts`, with `window.nyte` stubbed, so they are not E2E.
4. Real-runtime Electron. `app titlebar.electron.test.tsx` runs a full desktop `electron-vite build`, and desktop has `account`, `ipc-transport` and the gated benchmarks.
5. Real-binary PTY journeys in `packages/tui/qa`, with 10 cases.
6. Playwright in `packages/app/e2e`, with `web` and `desktop` projects. Desktop also has 9 `benchmark/*.spec.ts` perf specs that no test command runs.

#### Repeated Electron bundle cost

22 files call `testRenderer`, and every call runs its own Vite build and launches its own Electron process. A file can call it more than once, so the number of builds is at least 22. These files are the slowest in the app suite, at 10 to 28 s each under load. The titlebar test builds all of desktop in `beforeAll`, taking 37.6 s. Each `e2e:desktop` run builds the app and desktop again. Building once in a shared setup would likely save the most time. Nobody has measured it. It is a candidate, not part of this change.

#### CI coverage

`ci.yml` runs `pnpm exec turbo test`. That covers every package `test` script, including the TUI QA, which is part of `packages/tui`'s `test`. The service report notes that recent CI runs on main were failing. CI does not cover:

- the Playwright suites, web and desktop;
- the gated desktop Electron benchmarks;
- the root scripts `docs:dep:test` and `test:benchmark`. The root has no `test` script and `turbo.json` has no `//#test`.

Moving coverage from Vitest into Playwright removes it from CI unless a CI job runs the spec that took it over. The new job (see "Conversion") runs only `workspace.spec.ts`. The other web specs, the desktop E2E and the root scripts stay outside CI.

### Conversion

Agent `app` made this change. It is complete in the worktree and not committed. The final diff:

| Path | Change |
|---|---|
| `packages/app/e2e/web/workspace.spec.ts` | New, 100 lines, untracked. One test: "a paired browser reads, edits, blames, searches, and mentions workspace files". |
| `packages/app/e2e/web/files.spec.ts` | Deleted, 80 lines, 4 tests. |
| `packages/app/e2e/web/workbench.spec.ts` | Deleted, 22 lines, 1 test. |
| `packages/app/src/mention-files.test.ts` | Removed "mention discovery publishes the workspace files", 20 lines. The failure-path test stays. |
| `packages/app/src/workbench/workspace-search.test.tsx` | Removed "search starts idle with named matching controls…" and its now-unused imports. The other result, XSS and encoding tests stay. |
| `packages/app/src/screens/thread.tsx` | `composedPath` fix (see "Key finding"). |
| `packages/app/e2e/server/address.ts` | `NYTE_E2E_PORT`. It must be a whole number from 1 to 65535 and defaults to 5181. Another agent's `ARCHIVED_SESSION_COUNT` stays as it was. |
| `packages/app/e2e/README.md` | Documents the workspace journey, `NYTE_E2E_PORT`, the focused CI job, and building without account sign-in. |
| `.github/workflows/ci.yml` | New `e2e-web` job: install, `playwright install --with-deps chromium`, build the app, then run `playwright test … --project=web e2e/web/workspace.spec.ts`. |

7 cases became 1, a net reduction of 6:

- The 4 tests in `files.spec.ts`.
- The 1 test in `workbench.spec.ts`.
- 2 unit cases: `mention-files.test.ts` t1 and `workspace-search.test.tsx` t1.

Every boundary, race and security test stays.

The CI job runs only `workspace.spec.ts`. That spec carries the deleted unit cases, so CI has to run it. Running the whole web project would make this change depend on repairing `chat.spec.ts` and `pairing.spec.ts`. The desktop E2E and the root scripts stay outside CI.

Final checks after agent `app` stopped, run independently by the parent:

- `workspace.spec.ts` passed 1 of 1, at 1.9 s for the test and 3.2 s in Playwright. The run used the final built app with `CI=1`, port 5293, 1 worker and no retries.
- The 8 tests left in the two changed unit files pass.
- `oxlint` on the 5 changed source and spec files reported 0 warnings and 0 errors.
- `git diff --check` is clean.
- The full app suite passed 262, failed 4 and skipped 0 of 266 tests in 63 files, in 23.66 s. The log is `/tmp/nyte-test-audit-app-final.log`, and I read it. The 4 failures are the same as at the baseline: `icons`, `account-footer`, `models-settings-login` and `changes-commit`. The only change in the count is the 2 removed cases. The run took less time than the 51.4 s baseline, but the machine load and caches were different, so this is not an optimization.

Agent `app` also reports:

- `tsc --noEmit` passes for the app source.
- `tsc --noEmit -p e2e` fails at `e2e/server/start.ts:139`, because `host` isn't a property of `ServeOptions`. That line came from another agent's edit, not this change, which leaves `start.ts` alone.

The main agent checked the `NYTE_E2E_PORT` boundaries by hand:

- Accepted: unset (5181), `5181`, `5287`, `65535`.
- Refused: `0`, `65536`, empty, `1.5`, `no`.

#### Keep journeys to one flow

Build one workspace journey, not one test for the whole product. `journey.long` shows why. It claims 37 coverage items and failed at the child-background step, so the questions, queue, model, effort and usage beats never ran and nobody knows whether they work. A journey should cover one flow a user would recognize, and journeys should fail independently.

Second-pass update: the TUI redesign is finished. The TUI now has exactly two scenarios, one headless with 7 steps and one in a real PTY with 14, and the parent's final reviewed run passed all 21 steps. "TUI: two scenarios" has the details. That suite replaces the earlier advice about `journey.long`. The desktop `connect-interop` journey was measured and rejected (see the second-pass summary).

### First-pass candidates and what happened

- Core: `acceptance-delegation:234` deleted. `:273` kept with the assertions of `delegation:1248`, which was deleted. `step:1330` deleted. `step:783` kept as the only coverage of the `storeRun` path. `acceptance-delegation:109` trimmed. The `acceptance-*` drills were not added to the worker-store pass.
- ai and plugin: 3 `oauth-device-code` duplicates deleted. One `question.test.ts` case deleted.
- Services: 5 cases cut from `client.test.ts`. The wire live-watch pair and node's "refuses without a credential" were cut. `cli launcher` t1 was kept, because it is the only test of a cache hit without a fetch. The `connect relay` frame cases and node "binds loopback…" were kept.
- `app titlebar.electron.test.tsx` t2 to `e2e/desktop`: still a proposal.
- Slow waits: the fake-timer advice for plugin `openai-compaction` was wrong (see "Decisions and corrections"). The desktop sleeps that flake under load were not touched.
- Coupled tests: the Codex debug-counter assertions were removed, and the export stays. The plugin compaction tests keep their kernel imports until core exposes a public seam. The `serve` deep-equal was rewritten. The demo mocks stay, and a move to `packages/vercel` is proposed. The vercel argv assertions stay, with the reason in the appendix.
- Casts: still present.

### Protected coverage

Don't convert or thin these. A journey can't reach races, fencing, recovery, refusals or redaction.

- core: the store contract on every backend, queue and effect CAS races, lease and fencing, compaction recovery, relocation safety.
- host: workspace-file conflicts and path escape, git edge cases, tree-snapshot locks, plugin watchers.
- desktop: `host-connect` lease, replay and offline ordering; `connect-relay` flow control; login supersession; browser-report fencing against hostile pages.
- services: the connect-worker claim matrix, revoke and release races, the no-secret-in-D1 check, wire refusals, the vercel outbox crash recovery.
- app: auth concurrency, the tunnel token leak, optimistic rollback, save conflicts, search XSS and UTF-16 handling, live-display resync, and `screens/thread-render` row identity under deltas.
- providers: credential-store crash locks, OAuth redaction, web-search consent, MCP malformed input, SSE bounds.
- root: the dependency-docs malicious-entry and path-escape refusals.

At the first pass, the dirty tree had removed four tests and some assertions:

- `activation-state.test.ts` lost two recovery tests: "a new plugin set recovers a root whose own plugins failed to start" and "…recovers a child read before its failed root".
- `sdk-advance.test.ts` lost "a global setup failure leaves every session's old plugins and the default catalog intact" and "global publication rejection keeps session boundaries independent…".
- `host.test.ts` lost its override-failure assertions.

I read the same files again at 01:56, and the other agents' work has since changed them:

- `activation-state.test.ts:450` now has "a source change recovers a root whose plugins failed to start, and its child".
- `host.test.ts` again checks that a broken provider override fails the run, on a separate host built with that override.
- The two `sdk-advance.test.ts` tests are still gone. Nothing checks global setup failure or publication rejection across sessions.

These files belong to the owners of the plugin-reload work and are still changing. Check them again before relying on them.

### Open items outside this change

- `chat.spec.ts` fails on the hidden selected chat. It has to pass before CI can run the whole web project.
- `tsc -p e2e` fails at `start.ts:139`.
- No desktop E2E run.
- No runs on a clean HEAD for `account-footer`, the serve `defaults` test, host `:757` and `:117`, and plugin `mcp:293`.
- The unit and TUI QA failures listed under "Failures" that the second pass didn't fix.
## Appendix: all 317 baseline test files

This appendix has one row for each path in `/tmp/nyte-prune-main/inventory-before.json`. That inventory holds every tracked or untracked file matching `\.(test|spec|browser-test|type-test)\.[cm]?[jt]sx?$` at 01:37. Support files outside that pattern are listed only when an agent edited, deleted or blocked them.

The dispositions:

- keep: unchanged.
- trim: cases or assertions removed.
- rewrite: assertions replaced with stronger ones.
- delete: file removed.
- blocked-dirty: already dirty from other work, so reviewed and not edited.
- new, edited, rewritten: support files that the cross-review or the TUI redesign added or changed.

Reasons are shortened. The scope's `reviewed-files.json` has the full text, except where a cross-review or the TUI redesign changed a file later. Those rows say what changed. All 9 TUI test files are deleted, and the two TUI scenarios replace them. `python3 /tmp/nyte-prune-main/audit-draft/appendix.py` rebuilds the table and checks coverage. Its last run found 317 of 317 paths covered, with none missing. The only path with two rows is the benchmark smoke test, and the table uses the service row.

| Path | Scope | Disposition | Reason |
|---|---|---|---|
| `packages/ai/test/anthropic-account-limits.test.ts` | ai-plugin | keep | 2 cases. Exact normalized windows from the OAuth usage endpoint (URL, oauth beta header and claude-cli UA are the endpoint's wire contract). |
| `packages/ai/test/anthropic-auth-token.test.ts` | ai-plugin | keep | 4 cases. Env precedence AUTH_TOKEN > OAUTH_TOKEN > API_KEY with explicit-header override. |
| `packages/ai/test/anthropic-eager-tool-input-compat.test.ts` | ai-plugin | trim | Dropped 6 repeated x-api-key/authorization asserts unrelated to eager streaming. anthropic-auth-token still asserts both headers. 3 cases kept. |
| `packages/ai/test/anthropic-fast-mode.test.ts` | ai-plugin | keep | 3 cases. speed=fast plus merged beta header order; pricing follows response speed (60 vs 30 exact cost); unsupported/compatible models refused before fetch. |
| `packages/ai/test/anthropic-oauth.test.ts` | ai-plugin | keep | 13 cases. PKCE challenge==sha256(verifier) relation, redirect_uri per method, no scope on refresh, callback server 404/400 paths, state mismatch, provider error, prompt-vs-callback race (more in JSON) |
| `packages/ai/test/anthropic-stream.test.ts` | ai-plugin | keep | 20 cases. Own SSE decoder (separate from protocol/sse): interleaved tool blocks, signatures/redacted thinking, proxy relabel replay, fallback-model pricing, nullable usage, malformed frames (more in JSON) |
| `packages/ai/test/anthropic-strict-tool-schema.test.ts` | ai-plugin | keep | 2 cases. strict only for prefer JSON-schema tools; pi#9953 keyword fallbacks (integer bounds, minItems>1, regex format) vs supported keywords. |
| `packages/ai/test/auth-verification.test.ts` | ai-plugin | keep | 6 cases. verifyAuth ok/rejected/unreachable/unconfigured with secret-redaction checks. |
| `packages/ai/test/bun-oauth.test.ts` | ai-plugin | keep | 1 case. Swapped loaders prove registerBunOAuthFlows replaces whatever was registered (would fail if it no-oped). |
| `packages/ai/test/codex-terminal-usage.test.ts` | ai-plugin | keep | 14 cases. Exact usage/cost per terminal event over SSE and WS, failure-only WS frame without SSE fallback, absent vs explicit-zero usage, invalid counts rejected. |
| `packages/ai/test/credential-store.test.ts` | ai-plugin | keep | 16 cases. Real file store: 0600 mode, unreadable entries preserved, provider extras kept through refresh, corrupt file never replaced, cross-process lock with child processes, crash-lock (more in JSON) |
| `packages/ai/test/error-body.test.ts` | ai-plugin | rewrite | Truncation case now asserts the exact truncated output instead of a substring plus a length check. An off-by-one slice passed before and fails now. |
| `packages/ai/test/event-stream.test.ts` | ai-plugin | keep | 5 cases. Multi-consumer order, end releases waiters, undefined as value, lazy setup forwarding and setup failure as error event. |
| `packages/ai/test/fast-mode.test.ts` | ai-plugin | keep | 1 case. fast -> service_tier priority on both Codex and Responses request bodies; plugin fast-mode only tests the plugin layer (sets fast), not the wire mapping. |
| `packages/ai/test/github-copilot-catalog.test.ts` | ai-plugin | rewrite | Dropped `contextWindow/maxTokens > 0` over the test's own catalog fixture. Headless `getAvailable` asserts the exact ID list instead of `length > 0`. |
| `packages/ai/test/github-copilot-oauth.test.ts` | ai-plugin | rewrite | Impersonated client-version literals now compare against `GITHUB_COPILOT_API_VERSION`/`GITHUB_COPILOT_HEADERS`. Header delivery still checked: dropping X-GitHub-Api-Version fails 3 cases. 35 cases kept. |
| `packages/ai/test/github-copilot-transport.test.ts` | ai-plugin | rewrite | Same version-pin change as copilot-oauth: the test checks the headers reach the wire, not the brand strings. 11 cases kept. |
| `packages/ai/test/lax-message-content.test.ts` | ai-plugin | keep | 1 case. null/missing content normalized at the untyped boundary (issues #6259/#6276). |
| `packages/ai/test/models-catalog.test.ts` | ai-plugin | keep | 6 cases. ETag/304 revalidation and freshness skip, invalid/foreign/undispatchable entries dropped, raw feed persisted and filtered on read, legacy pre-filtered file refetched, HTTP failure (more in JSON) |
| `packages/ai/test/models-runtime.test.ts` | ai-plugin | trim | Dropped one `toBeInstanceOf(AbortSignal)` that the next aborted/reason asserts imply. 31 cases kept. |
| `packages/ai/test/node-http-proxy.test.ts` | ai-plugin | keep | 3 cases. scoped env precedence, SOCKS refusal, NO_PROXY wildcard/IPv6/port matching with exact results. |
| `packages/ai/test/oauth-auth.test.ts` | ai-plugin | keep | 3 cases. Re-evaluated deleting the Copilot getAuth case: mutation in auth/resolve.ts dropping OAuth baseUrl is not caught by any direct retained assertion (only indirectly by the bun bundle (more in JSON) |
| `packages/ai/test/oauth-device-code.test.ts` | ai-plugin | trim | 5 to 2 cases. Immediate first poll, slow_down interval and cancel are covered by openai-codex-oauth and github-copilot-oauth. A mutation probe on each made the retained tests fail. |
| `packages/ai/test/oauth-page.test.ts` | ai-plugin | keep | 3 cases. HTML escaping of provider/message/details (XSS); no scripts/external URLs on the localhost callback page (privacy property, presence checked by the other two cases). |
| `packages/ai/test/openai-codex-account-compaction.test.ts` | ai-plugin | keep | 52 cases (~5s). Codex V2 compaction wire: retained-window truncation (exact), image budget, retry budget across opens/streams, delay caps, redaction of prompts/keys from errors, usage per (more in JSON) |
| `packages/ai/test/openai-codex-oauth.test.ts` | ai-plugin | keep | 7 cases. Device flow end-to-end with exact poll times (now retained owner for device-code immediate poll and cancel), 15-min timeout, 403/404 pending, body in failure, no stderr, port 1455 (more in JSON) |
| `packages/ai/test/openai-codex-stream.test.ts` | ai-plugin | rewrite | Removed 9 asserts on test-only debug counters. Added real checks: `previous_response_id` on turn 2 and sticky SSE fallback after a connect timeout. 11 mock socket classes became one helper. 1883 to 1274 LOC. |
| `packages/ai/test/openai-compaction.test.ts` | ai-plugin | rewrite | `cost.total > 0` became the exact `0.00033` the pricing produces. |
| `packages/ai/test/openai-completions.test.ts` | ai-plugin | keep | 7 cases. reasoning_details order/merge and replay, empty text beside images, unterminated tool args, requiresToolResultName/grouped images, strict defaults. |
| `packages/ai/test/openai-responses-namespace.test.ts` | ai-plugin | keep | 4 cases. Namespace round trip on function/custom calls, dropped for targets that cannot replay load items (toBeDefined paired with not.toHaveProperty), foreign item ids dropped. |
| `packages/ai/test/openai-responses-terminal-event.test.ts` | ai-plugin | keep | 11 cases. Early EOF, phases, incomplete reasons, usage/service-tier pricing, unfinished tool call, missing output_index (pi #9974). |
| `packages/ai/test/opencode-provider-headers.test.ts` | ai-plugin | keep | 5 cases. sessionId -> x-opencode-session on both methods, case-insensitive caller override incl. null, no fabrication. |
| `packages/ai/test/provider-retry.test.ts` | ai-plugin | keep | 6 cases. retry-after-ms timing with fake timers, Infinity headers, x-should-retry false, delay cap, abort during wait. |
| `packages/ai/test/public-copilot-exports.test.ts` | ai-plugin | keep | 1 case (~1.2s, bun build). Browser bundle logs in with no Node globals; also the only indirect catcher of OAuth baseUrl drop in resolve.ts. |
| `packages/ai/test/retry.test.ts` | ai-plugin | keep | 11 cases. Retry classification by real provider messages, retry counts/order of callbacks, delay cap, abort during backoff. |
| `packages/ai/test/system-message-replay.test.ts` | ai-plugin | keep | 7 cases. Transcript system-message replay, collapse idempotence, tool state diffs, redefinition detection. |
| `packages/ai/test/transcript-tool-changes.test.ts` | ai-plugin | keep | 11 cases. Per-API mid-conversation tool/system changes (native, fallback, Kimi variants) with exact payload shapes. |
| `packages/ai/test/uuid.test.ts` | ai-plugin | keep | 2 cases. Monotonic v7 under clock rollback, follower timestamps, 48-bit range. |
| `packages/ai/test/validation.test.ts` | ai-plugin | keep | 8 cases. AJV-compatible coercions, null-as-omission, CSP fallback. Style debt (as-casts, pi-synced) reported, not a pruning target. |
| `packages/app/e2e/desktop/browser.spec.ts` | app | keep | Real desktop journey (blocking toggle, downloads, find, popup opener, basic auth, permission, crash recovery); every step asserts user-visible effect or request counts; no unit duplicate. |
| `packages/app/e2e/desktop/remote-access.spec.ts` | app | keep | Only test of pairing a browser through desktop Remote access, cross-client session visibility and stop revoking access (ERR_CONNECTION_REFUSED). Not edited. |
| `packages/app/e2e/web/chat.spec.ts` | app | keep | Routing/history/reload/startup-destination journey with echo provider; distinct scenario. |
| `packages/app/e2e/web/pairing.spec.ts` | app | keep | Security/negative coverage: token stripped from URL/history, wrong token rejected and nothing stored, wrong-token link keeps address. Not edited. |
| `packages/app/e2e/web/sidebar.spec.ts` | app | blocked-dirty | Untracked, owned by another agent. Reviewed: literal paging counts. No change. |
| `packages/app/e2e/web/workspace.spec.ts` | app | keep | Prior-task-owned (untracked) consolidated web workspace journey; kept intact per instructions. |
| `packages/app/lint/control-size.test.ts` | app | keep | Runs real oxlint plugin on fixture and asserts exact (line, rule) list; catches rule going silent or over-reporting. |
| `packages/app/lint/design-scale.test.ts` | app | keep | Exact reported-line set, per-line rule ids, foreign create import ignored, replacement-step messages; t1/t3 overlap partially but t3 asserts rule identity/count t1 cannot. Kept. |
| `packages/app/lint/interactions.test.ts` | app | keep | Rejected vs accepted fixtures assert exactly one diagnostic per rule; catches both false negatives and false positives. |
| `packages/app/src/chrome/account-footer.test.tsx` | app | rewrite | Baseline failure fixed in the fixture: the test now installs the web bridge the component reads since 9b9d837a. Assertions unchanged. |
| `packages/app/src/chrome/github-account.test.tsx` | app | trim | 12 to 8. Cut a TanStack keep-data-on-error check and 3 rows of the recovery matrix that ran the same path. Kept the row that runs the app's `kind:error` throw. |
| `packages/app/src/chrome/models-settings-login.electron.test.ts` | app | keep | Real Electron + recorded bridge: device code, copy/open failures, cancel refused, discovery-failed message; asserts recorded host payloads. |
| `packages/app/src/chrome/nyte-connection.browser-test.tsx` | app | keep | Drives link/unlink tray through states; checks pending/lapsed lease never reads Reachable, relay URL and session label never leak, confirm-before-unlink, no credential-shaped data in caches (more in JSON) |
| `packages/app/src/chrome/nyte-connection.test.ts` | app | keep | Runs `nyte-connection.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/chrome/profile-settings.test.tsx` | app | keep | Device-code sign-in markup, group independence across GitHub/Nyte states (relation), and Profile listed only for web server with environment (branch not covered by settings/navigation.test). |
| `packages/app/src/chrome/server-settings-tunnel.browser-test.tsx` | app | keep | Lagging device list race keeps pairing code; code leaves on claim/removal/expiry; token never in query cache (security). |
| `packages/app/src/chrome/server-settings-tunnel.test.ts` | app | keep | Runs `server-settings-tunnel.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/chrome/titlebar.electron.test.tsx` | app | keep | t1 geometry/zoom alignment needs real Electron window. t2 is a user journey; proposal (not done): move to e2e/desktop to avoid a full desktop build inside the unit suite. |
| `packages/app/src/client-actions.test.tsx` | app | trim | 13 to 12. Cut the palette label list (constant pin) and the Kbd keycap SSR check (belongs to @nyte-ai/ui). Accelerator literal kept. |
| `packages/app/src/components/animated-number.browser-test.tsx` | app | trim | Dropped the check that compared the animation to the same CSS vars the code reads. Morph, no-shift, accessible value and cancel kept. |
| `packages/app/src/components/animated-number.test.ts` | app | keep | Runs `animated-number.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/conversation/blank-draft.test.ts` | app | keep | Draft parking/reuse/restore/persistence and corrupt storage not crashing; no other coverage. |
| `packages/app/src/conversation/code-block-memory.test.ts` | app | keep | Worker lifecycle: no worker when aborted, failed send/terminate, error replaces worker; literal results. |
| `packages/app/src/conversation/composer-document.test.ts` | app | keep | Lexical document offsets, chips, completion, undo, refresh; literal text/selection outputs. |
| `packages/app/src/conversation/composer-editor.browser-test.tsx` | app | keep | Native selection preservation, composition deferral, no bounds reads when inactive, AutoLink; real DOM only. |
| `packages/app/src/conversation/composer-editor.test.ts` | app | keep | Runs `composer-editor.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/conversation/composer-latency.browser-test.tsx` | app | keep | Perf harness producing latency report. |
| `packages/app/src/conversation/composer-latency.test.ts` | app | keep | Keystroke-per-frame and p95/max latency budget in production build (retry:2 preexisting, unchanged). |
| `packages/app/src/conversation/diff-separator.browser-test.tsx` | app | keep | Visible expansion control reveals collapsed context in real Pierre shadow DOM. |
| `packages/app/src/conversation/diff-separator.test.ts` | app | rewrite | Three bare `rejects.toThrow()` now assert the exact refusal message for binary, truncated and missing-previous sides. |
| `packages/app/src/conversation/diff-view-multi.test.tsx` | app | keep | Twice-edited file renders two diffs and unparseable patch degrades to text instead of throwing (crash guard). |
| `packages/app/src/conversation/mermaid-diagram.test.ts` | app | keep | Worker cancel/terminate/fallback lifecycle. |
| `packages/app/src/conversation/message-content.browser-test.tsx` | app | keep | Read-only chips, hidden skill instructions, focus not stolen, URL opens via host, oversize guard. |
| `packages/app/src/conversation/message-content.test.tsx` | app | keep | Runs `message-content.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/conversation/step-group-presentation.test.ts` | app | keep | Summary verbs/tallies literal outputs. |
| `packages/app/src/conversation/step-group.browser-test.tsx` | app | keep | Follow/pause/resume scrolling, open-in-place, row identity across settle. |
| `packages/app/src/conversation/step-group.test.ts` | app | keep | Runs `step-group.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/conversation/subagent-call.test.tsx` | app | keep | SSR markup but asserts state-driven behaviour: one card per create, provisional agent shows no Stop/Stop all. |
| `packages/app/src/conversation/tray/questions-state.test.ts` | app | keep | Reply validation table, payload sent, blank reply never sent, stale/refresh/transport outcomes. |
| `packages/app/src/layout/pane-actions.test.tsx` | app | keep | SSR hook probe but asserts real effect: split refused below 640px and focusNext agrees; newChat leaves Customize and selects blank pane in controller. |
| `packages/app/src/layout/session-removal.test.ts` | app | keep | Undo restores archived panes/focus, never overwrites newer chat or draft (data loss). |
| `packages/app/src/live-display.test.ts` | app | keep | 26 cases: fold/rebase/resync/read-count contracts with literal transcript/tool output; read counts are the product contract (no redundant snapshot reads). No duplicate found. |
| `packages/app/src/mention-files.test.ts` | app | delete | Deleted. Its last case checked TanStack's rejection on a pass-through queryFn. The success path is the mention step of `e2e/web/workspace.spec.ts`, which CI runs. |
| `packages/app/src/router-preload.test.ts` | app | trim | 3 to 2. Cut a retry-after-failure case: TanStack never caches a rejection and the app has no branch for it. |
| `packages/app/src/screens/thread-render.browser-test.tsx` | app | keep | Row identity across landing and live deltas, action message stays read-only, edit not closed by deltas. |
| `packages/app/src/screens/thread-render.test.ts` | app | keep | Runs `thread-render.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/server-connection.test.ts` | app | keep | serverCatalog literal outputs for with/without default model. |
| `packages/app/src/session-actions.test.ts` | app | keep | Optimistic archive/rename/delete with rollback, Undo races, partial bulk failure; data-loss coverage with literal state checks. |
| `packages/app/src/session-configuration.test.ts` | app | keep | Draft model choice survives default snapshots and stale reads until ack; failure restores host state. |
| `packages/app/src/session-directory-feed.test.ts` | app | rewrite | The availability test asserted `ids()==[]`, which a no-op passes. It now asserts the literal cloud directory entry. |
| `packages/app/src/session-read-state.test.tsx` | app | keep | Unread completion logic across restart/heads/stale polls/corrupt storage; 'every row state looks different' is a distinctness relation over StatusDot classes, not a token pin. |
| `packages/app/src/settings/navigation.test.ts` | app | keep | isSettingsSection per host (web/desktop/relay env) ; literal booleans from settingsContext branches. |
| `packages/app/src/snapshot-cache.test.ts` | app | keep | Eviction budget, readers never evicted, release drops only unobserved; one weak bound (retained<=2) sits beside literal checks. |
| `packages/app/src/startup.test.ts` | app | keep | Mount ordering and retry after resource/route failure. |
| `packages/app/src/tabs/model.test.ts` | app | keep | Window tab reducer: travel through split, close hand-over, reopen cap 25, shortcuts wrap; literal outcomes. |
| `packages/app/src/tabs/window-tab-strip.browser-test.tsx` | app | keep | Drag reorder payload, middle-click close, only tab unclosable with balanced padding (real geometry). |
| `packages/app/src/tabs/window-tab-strip.test.ts` | app | keep | Runs `window-tab-strip.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/theme/tray-surface.browser-test.tsx` | app | keep | Relation checks: tray differs from page in dark, equals composer surface, row does not fill over tray (regression described). |
| `packages/app/src/theme/tray-surface.test.ts` | app | keep | Runs `tray-surface.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/usage-query.test.ts` | app | trim | 14 to 5. Cut duplicate parameter rows and tests that passed `cancelRefetch:false` themselves, then asserted TanStack. `useUsageReport` view mapping was never tested, before or after. |
| `packages/app/src/web/account-device.test.ts` | app | trim | 5 to 4. Cut `parseAccountConfig` cases: mobile's suite tests the same connect function more thoroughly. |
| `packages/app/src/web/bridge.test.ts` | app | trim | 2 to 1. Cut six `toBeUndefined` checks that an empty host passes. The workspace journey asserts Terminal and Browser are absent on web. |
| `packages/app/src/web/sign-in.test.ts` | app | keep | Environment sign-in: each state emitted once, pasted code forwarded to same attempt, non-web link never shown and attempt cancelled (security), failure emits no catalog_changed, webPageUrl (more in JSON) |
| `packages/app/src/workbench/browser-occlusion.browser-test.tsx` | app | keep | Menu over browser panel hides page without moving bounds, restores on close. |
| `packages/app/src/workbench/browser-occlusion.test.ts` | app | keep | Runs `browser-occlusion.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/workbench/changes-commit-actions.test.ts` | app | rewrite | `length>0` plus a self-referential deepEqual became the literal withheld set `["commit-pull-request","pull-request"]`. |
| `packages/app/src/workbench/changes-commit.browser-test.tsx` | app | rewrite | Baseline failure fixed: the selector accepts `menuitemradio`, which the dirty commit bar now renders. All behavior checks unchanged. |
| `packages/app/src/workbench/changes-commit.test.ts` | app | keep | Runs `changes-commit.browser-test.tsx` in Electron. That row has the review. Baseline failure, now passes. |
| `packages/app/src/workbench/changes-panel.browser-test.tsx` | app | keep | Tree/stack agree, counts, revert only for working tree, commit/pending/error/binary scopes. |
| `packages/app/src/workbench/changes-panel.test.ts` | app | keep | Runs `changes-panel.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/workbench/changes-revert.browser-test.tsx` | app | keep | Confirm-before-revert, cancel calls nothing, skip reason, trash copy, hidden panel reads nothing, review mark cleared (data loss). |
| `packages/app/src/workbench/changes-revert.test.ts` | app | keep | Runs `changes-revert.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/workbench/changes-scope.browser-test.tsx` | app | keep | Observation producer for scope switching/fallback/failure recovery. |
| `packages/app/src/workbench/changes-scope.test.ts` | app | keep | Asserts observations literally plus diffRequestForScope literal mapping. |
| `packages/app/src/workbench/changes-sidebar.browser-test.tsx` | app | keep | Filter counts, reveal vs sync selection, bulk review, collapsed folders retained across updates. |
| `packages/app/src/workbench/changes-sidebar.test.ts` | app | keep | Runs `changes-sidebar.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/workbench/changes-stack.browser-test.tsx` | app | keep | Collapse one file without affecting another; height restores. |
| `packages/app/src/workbench/changes-stack.test.ts` | app | keep | Runs `changes-stack.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/workbench/file-document.test.ts` | app | keep | Save/format/conflict races; literal buffer snapshots. |
| `packages/app/src/workbench/file-store.test.ts` | app | keep | Tab ids, isolated drafts, dirty close, previews, history. |
| `packages/app/src/workbench/tab-strip.browser-test.tsx` | app | trim | Dropped a colour check built from the same tokens the component uses. Order, focus, drag and close-button checks kept. |
| `packages/app/src/workbench/tab-strip.browser.test.ts` | app | keep | Runs `tab-strip.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/src/workbench/terminal-store.test.ts` | app | trim | Dropped one assert that read the test's own unmutated fixture. 6 cases kept. |
| `packages/app/src/workbench/workspace-search.test.tsx` | app | keep | Prior-task-edited (dirty, allowed). Re-reviewed: multi-file grouping/Unsaved badge, case-preserving highlight, UTF-16 offsets, zero-width marker, XSS escaping, state announcements (more in JSON) |
| `packages/app/test/control-targets.browser-test.tsx` | app | keep | Measures real hit areas for >200 controls under fine/coarse pointers and group overlap. |
| `packages/app/test/control-targets.electron.test.ts` | app | keep | Runs `control-targets.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/test/icons.browser-test.tsx` | app | keep | Only render coverage of @nyte-ai/ui icons (ink/luminance vs references, state colour inheritance). Baseline FAIL 'light warning:outlined ink changed'. |
| `packages/app/test/icons.electron.test.ts` | app | keep | Runs `icons.browser-test.tsx` in Electron. That row has the review. Baseline failure, still fails. |
| `packages/app/test/style-order.browser-test.tsx` | app | keep | className/style/xstyle precedence over component rule with literal computed values. |
| `packages/app/test/style-order.electron.test.ts` | app | keep | Runs `style-order.browser-test.tsx` in Electron. That row has the review. |
| `packages/app/test/tokens.test.ts` | app | keep | Runs appearance and contrast fixtures; contrast floors 4.5/3 per scope. 2->2 cases, passes. |
| `packages/cli/test/distribution.test.js` | svc | trim | Dropped the `Checksum ok.` progress-copy pin. The mismatch-rejection half of the same test proves verification. |
| `packages/cli/test/launcher.test.js` | svc | keep | Test 1 is the only check of cache hit without fetch and extracted bytes (distribution's ensureBinary call only checks docs); test 2 checksum mismatch. |
| `packages/client/test/client.test.ts` | svc | trim | 25 to 20. 5 cases cut as duplicates of server and protocol tests. Cross-review F1: the client suite lost in-package coverage of all 3 wire-error mappings. Approved fix folds the controls into existing cases. |
| `packages/client/test/outbox.test.ts` | svc | rewrite | Subscriber test: `seen.length >= 2` became a check with a positive control. Cross-review follow-up: the row sort was never tested. The `activate` case now inserts against time order, and a no-sort mutant fails. 13 cases. |
| `packages/client/test/session-state.test.ts` | svc | keep | Fold logic: commit removes landed change from pending, foreign/no-change commits leave pending, parked asks restore + waitingCall newest, terminal jobs clear progress, settled calls ignore (more in JSON) |
| `packages/client/test/system-messages.test.ts` | svc | keep | contextMessages/modelContext/projectTree/projectUsage on literal commit chains: checkpoint system snapshot leads, native material only for exact target, call/result pairing across a system (more in JSON) |
| `packages/client/test/tool-status.test.ts` | svc | trim | 7 to 2. Cut 5 tests that restate rows of the `toolStatus` switch. Exit-code interpolation and durations kept. |
| `packages/client/test/transcript.test.ts` | svc | keep | transcriptFromCommits/appendTranscriptCommit/transcriptWithRun: settlement vs isError precedence, open call follows run phase/parked selection, incremental==full projection, failure (more in JSON) |
| `packages/cloudflare/test/alarm.test.ts` | svc | keep | Alarm scheduling: watchdog before work, resume after restart, admission racing final rearm, outcome->deadline mapping, starvation isolation, queued-only heads scanned. |
| `packages/cloudflare/test/routing.test.ts` | svc | rewrite | `notEqual(keys[0], keys[1])` became the literal Durable Object names, which also proves the forged `?tenant=` is ignored. |
| `packages/cloudflare/test/sqlite.test.ts` | svc | keep | durableSqlite enforces the 100-parameter and byte budget (src/sqlite.ts checkBindings); 501 deletes and oversized UTF-8 refusal through the real adapter. |
| `packages/connect-worker/test/auth.test.ts` | svc | keep | 11-claim refusal matrix with positive controls, foreign key/malformed bearer, banned owner/denied session, 9 noncanonical CONNECT_WEB_ORIGINS fail closed, CORS on config failure, JWKS has (more in JSON) |
| `packages/connect-worker/test/cron.test.ts` | svc | keep | Lapsed reservation revoked + policy bump; replay/rate rows pruned only after expiry (presence before, absence after); denial kept when Clerk never confirms. |
| `packages/connect-worker/test/enroll.test.ts` | svc | keep | Active only after receipt (state 'reserved' during forward), 6 desktop failure modes leave no usable device, revoke/remove/lapse during forward block activation, replacement, limit, owner (more in JSON) |
| `packages/connect-worker/test/lease.test.ts` | svc | keep | Lease claims bound to proof, replay/foreign key/cross path/body refusals, monotonic policy, revoked env 410, Clerk freshness cache and stale-bound 503 retry-after. |
| `packages/connect-worker/test/link.test.ts` | svc | keep | Link contract, owner label fallbacks, banned/locked/unknown owner refusal, proof required/forged/replayed, key stolen -> 409, 3-environment cap under 6 concurrent links, listing isolation (more in JSON) |
| `packages/connect-worker/test/relay.test.ts` | svc | trim | The relay journey ran once per web origin (3); now once. The preflight tests still accept each origin through the same `origins.includes`. Two filler asserts removed. |
| `packages/connect-worker/test/release.test.ts` | svc | keep | Release vs strong revoke semantics: idempotent, never clears revocation, race in either order, release during forward blocks activation, upgrade of replaced device. |
| `packages/connect-worker/test/revoke.test.ts` | svc | keep | Owner and desktop revoke paths reset relay + revoke Clerk session + deny re-enroll while new session works; Clerk retry via cron until confirmed; environment removal idempotent; slot freed. |
| `packages/connect-worker/test/secrets.test.ts` | svc | keep | No JWT/Clerk secret/machine key/digest in D1, logs, or error bodies across 9 paths; event names act as the positive control that logs were written. |
| `packages/connect-worker/test/webhook.test.ts` | svc | keep | Unsigned/wrong-secret/stale refused with lease still 200; updated_at ordering for ban/unban/lock; deletion terminal; unknown events acked 204 (Clerk retry contract). |
| `packages/connect/test/client.test.ts` | svc | trim | 15 to 16: gained the `#x` origin row so this file owns the whole `isBrokerOrigin` refusal matrix moved from mobile. |
| `packages/connect/test/encoding.test.ts` | svc | trim | 15 to 14. Cut a padded-digest case that repeats the remainder loop. |
| `packages/connect/test/relay.test.ts` | svc | rewrite | The 503 envelope keeps status and `code:"closed"` literal, and the message is `expect.any(String)` (a table row). Cross-review F4: frame refusals lack positive siblings. Approved fix adds 4 literal frames. |
| `packages/connect/test/signing.test.ts` | svc | trim | 9 to 8. Cut a self-referential thumbprint check. Cross-review F5: the lifetime refusal accepts any error. Approved fix matches the exact message. |
| `packages/core/benchmark/smoke.test.ts` | svc | trim | 3 to 2. Cut a determinism check that compared the fixture generator to itself. Edited by svc. corehost saw it go dirty mid-task and agrees. |
| `packages/core/test/background-jobs.test.ts` | corehost | blocked-dirty | Dirty from the plugin-reload refactor. Reviewed: delivery-once, abort and reopen interruption are strong. No candidate. |
| `packages/core/test/bounded-tools.test.ts` | corehost | keep | Spill-file full bytes, ENOENT close error, stdout/stderr delivery, BOM/Unicode chunking, abort, truncation with exact continuation text, oversized first line. |
| `packages/core/test/client-session-follow.test.ts` | corehost | keep | SessionObserver race/coalescing tests; read-count assertions are the observable coalescing behavior; stale refresh drop, resync, recovery, close. |
| `packages/core/test/context-files.test.ts` | corehost | rewrite | Exact `project_context` prompt literal became a mechanism check: empty list gives `''`, two files keep path and content in order. |
| `packages/core/test/image-pipeline.test.ts` | corehost | keep | Image bounding at processImage, bound tool, and SDK upload paths (different entry points), undecodable passthrough; literal dimensions from real decode. |
| `packages/core/test/jobs-recovery.test.ts` | corehost | rewrite | The quiet-interruption test asserted only absences and passed with `interruptOwned` removed. It now calls `recover()` first; the same mutation fails it (`mut/jobs-noop*.log`). |
| `packages/core/test/kernel/acceptance-concurrency.test.ts` | corehost | keep | README drills: 100 concurrent submitters chain+landing order, submit during publish, head move during run (retained superset for deleted step test), lease takeover fences writes (more in JSON) |
| `packages/core/test/kernel/acceptance-delegation.test.ts` | corehost | trim | 4 to 3. Cut the idle-head case (step.test's idleHeads loop is stronger). The two-connection race absorbed the assertions of delegation.test's one-Session race. |
| `packages/core/test/kernel/acceptance-effects-events.test.ts` | corehost | keep | Crash safe/never replay (retained for deleted turn test), legacy root other-environment refusal, first-signal-wins after host restart, independent cursors, expired cursor floor. |
| `packages/core/test/kernel/acceptance-history.test.ts` | corehost | keep | Stale stack base, atomic fast-forward merge under concurrent send, loose-object grace boundary from a real failed publish (retained for deleted gc test). |
| `packages/core/test/kernel/activation-state.test.ts` | corehost | blocked-dirty | Dirty from other work, which now has a combined root-and-child recovery test at :450. Reviewed, not edited. |
| `packages/core/test/kernel/activation.test.ts` | corehost | keep | Plugin contributions/settings facts, checkpoint-scoped session messages, before_tool rewrite/deny/error policy, agent model+persona+ceiling, replacement drains active command, nested (more in JSON) |
| `packages/core/test/kernel/cache-warmer.test.ts` | corehost | keep | Timing/economics scheduler with fake timers; deadlines, overrides, horizons, abort; formatting test checks literal output of time/percent formatting logic, not a constant. |
| `packages/core/test/kernel/cache-warming.test.ts` | corehost | keep | SDK warm request equals dispatched context, bills on usage ref without moving head, survives reopen; plugin stop decision. |
| `packages/core/test/kernel/compaction-budget.test.ts` | corehost | keep | Bounded portable fallback, chunking within window (asserted in provider), cancellation, native context status, denser-tokenization retry, branch summary within window, tool-call rejection. |
| `packages/core/test/kernel/compaction-recovery.test.ts` | corehost | keep | Abandoned compaction cleared for watchers before response, deletion fails start, lease released when clear fails, save/publish faults leave no active compaction. |
| `packages/core/test/kernel/compaction.test.ts` | corehost | keep | Cut integrity, checkpoint lands/busy/nothing, prepare threshold, overflow compacts once then fails, step publishes checkpoint and re-asks. |
| `packages/core/test/kernel/completion.test.ts` | corehost | keep | Completion joins next response without swallowing queued input; stopped completion response stays out of request turn. |
| `packages/core/test/kernel/delegation.test.ts` | corehost | trim | 20 to 19. The one-Session race merged into acceptance-delegation's two-connection race. Some later hunks (`peer()` fixture, keyed-receipt race) belong to the in-order-send work, not the prune. |
| `packages/core/test/kernel/effect-fencing.test.ts` | corehost | keep | Takeover fencing at each effect state and boundary through turn and step (retained superset for deleted effects test), competing settlement, closed-store failure. |
| `packages/core/test/kernel/effects.test.ts` | corehost | trim | 10 to 9. Cut the lost-lease case: effect-fencing's takeover test asserts every fenced step and unchanged refs. |
| `packages/core/test/kernel/gc.test.ts` | corehost | trim | 3 to 2. Cut the loose-object case: acceptance-history asserts the same rule at the exact grace boundary on a real failed publish. |
| `packages/core/test/kernel/live-parts.test.ts` | corehost | keep | Live-part fold keys, tool progress replacement, terminal clears per run, shared-seq settlement, SDK fold equals snapshot. |
| `packages/core/test/kernel/objects-chain.test.ts` | corehost | keep | Store chain query contract incl. missing parent, forged cycle, batch delete; runs in worker-store pass. |
| `packages/core/test/kernel/outbox.test.ts` | corehost | keep | Backpressure without loss/reorder; latest-progress coalescing. |
| `packages/core/test/kernel/patch.test.ts` | corehost | keep | Patch parser edge cases with literal parsed outputs (separators, CRLF, malformed, rename, quoted path). |
| `packages/core/test/kernel/provenance.test.ts` | corehost | keep | Commit call classes from real tools (edit patch, shell exit settlement), provider error classification once, unknown tool custom. |
| `packages/core/test/kernel/provider-compaction.test.ts` | corehost | keep | Native compaction lifecycle, fallback prompt, cancellation keeps usage, lease kept until publish, lease loss aborts. :352 is a known load-sensitive baseline flake (60ms TTL). |
| `packages/core/test/kernel/queue.test.ts` | corehost | keep | Admission boundary for invalid heads (no writes), concurrent submit chains, idempotent keys, redeliver/cancel/edit/reorder races; worker-store pass backend contract. |
| `packages/core/test/kernel/run-trees.test.ts` | corehost | keep | runs.diff/revert tree pair selection (from/to encoded in fake paths), busy/conflict/reverted, recorded fallback without backend. |
| `packages/core/test/kernel/sdk-admission.test.ts` | corehost | keep | P2 is applied: a second `runs.abort` while the abort is pending must answer `requested` with the same run id. Before, nothing covered it. 12 of 12 pass on both stores. |
| `packages/core/test/kernel/sdk-advance.test.ts` | corehost | blocked-dirty | Dirty: lost two global setup-failure tests to other work. Report-only overlap with step.test on config without input. |
| `packages/core/test/kernel/sdk-awaiting-reply.test.ts` | corehost | keep | Question vs background park distinguished in session rows and sessionMark. |
| `packages/core/test/kernel/sdk-compaction-navigation.test.ts` | corehost | rewrite | 8 to 7. Cut the failed-summary case (sdk-summary-diagnostics is a superset). Prompt-template pin now asserts the stored summary carries the model output. |
| `packages/core/test/kernel/sdk-events.test.ts` | corehost | keep | Ref->SessionEvent projection and row folding; literal outputs of projection logic. |
| `packages/core/test/kernel/sdk-model-config.test.ts` | corehost | keep | No silent model substitution, executor inputs visible to other host, >200-commit declarations, legacy metadata and rewind. |
| `packages/core/test/kernel/sdk-runner.test.ts` | corehost | keep | Gated stale run-ref read and final-event races cannot cancel the next run; faulted runner drops deadline timer. |
| `packages/core/test/kernel/sdk-snapshot-reads.test.ts` | corehost | keep | Snapshot equals composed SDK reads (consistency relation) + bounded chain-query count (README paging contract), failed tool classes, missing/closed, ancestry recheck. |
| `packages/core/test/kernel/sdk-summary-diagnostics.test.ts` | corehost | keep | Security: redaction matrix (no secret in outcome/events/objects), diagnostics correlation, expected conflict/fenced, request option/telemetry precedence. |
| `packages/core/test/kernel/sdk-wait.test.ts` | corehost | keep | runs.wait abort/listener-leak/timer cleanup and holder preservation; stale waiting observation. |
| `packages/core/test/kernel/sdk-watch.test.ts` | corehost | keep | Watch notice backpressure, exits drain, synced cursor siblings, expiry, close paths, failure cleanup; worker-store pass. |
| `packages/core/test/kernel/sdk.test.ts` | corehost | blocked-dirty | Dirty from the reload refactor. Report-only: the streaming-close test has no assertion beyond `within()`. |
| `packages/core/test/kernel/session-relocation-safety.test.ts` | corehost | blocked-dirty | Dirty. Reviewed: fencing, trust after move and cross-connection reservations are strong. |
| `packages/core/test/kernel/session-relocation.test.ts` | corehost | blocked-dirty | Dirty. Reviewed: history, tool rebinding, busy refusal and trust on resume are strong. |
| `packages/core/test/kernel/sqlite-boundary.test.ts` | corehost | keep | Malformed object/event rejection and atomic invalid batches; worker-store pass. |
| `packages/core/test/kernel/sqlite-replay.test.ts` | corehost | keep | Replay paging, slow consumer, limits, abort/close phases, trim overtaking, malformed beyond first page; worker-store pass. |
| `packages/core/test/kernel/step.test.ts` | corehost | trim | 32 to 30. Cut the head-move case (acceptance-concurrency covers it) and the repeated-abort case, which drove only the test helper. Its cited coverage was wrong: pending-abort repeat is uncovered, and P2 adds it in sdk-admission. |
| `packages/core/test/kernel/store.test.ts` | corehost | keep | Store contract by outcome (CAS, atomic batches, reflog, trim, leases/fencing, watch, lifecycle, schema refusal); worker-store pass, Postgres mirror. |
| `packages/core/test/kernel/telemetry-truth.test.ts` | corehost | trim | 7 to 6. Cut the span pass-through case. The CAS-result span test covers return and rethrow through a real step. |
| `packages/core/test/kernel/transcript-state.test.ts` | corehost | blocked-dirty | Dirty. Reviewed: declaration invariants are strong. No candidate. |
| `packages/core/test/kernel/turn.test.ts` | corehost | trim | 28 to 27. Cut the crash-replay case: acceptance-effects-events runs the same safe/never decision through a real crash and reopen. |
| `packages/core/test/kernel/usage-accounting.test.ts` | corehost | keep | Usage retained across retry/failure/cancel/conflict/rewind/reopen with literal token/cost sums; applicability prefix rule. |
| `packages/core/test/kernel/workspace-activation.test.ts` | corehost | keep | Trust/security boundaries: unsupported/unreachable providers, refused workspace acts nowhere, project plugin cannot provide environment, inheritance, malformed workspace. |
| `packages/core/test/plugin-host.test.ts` | corehost | keep | Hook budgets fail closed, staged reload keeps old policy, plugin order, private staging, timed-out setup refused, queued revalidation republishes. |
| `packages/core/test/postgres-network.test.ts` | corehost | keep | Env-gated (NYTE_TEST_POSTGRES_URL) real network pools fencing; skipped by default, not a removal candidate. |
| `packages/core/test/postgres-store.test.ts` | corehost | keep | PostgreSQL backend contract via pglite (schema refusal, atomic CAS, rollback, fencing, watch, validation, reopen). |
| `packages/core/test/subagents.test.ts` | corehost | blocked-dirty | Dirty. Report-only overlap with sdk-model-config through a different trigger, likely keep both. |
| `packages/core/test/tool-boundary.test.ts` | corehost | keep | Runtime schema validation before work, heterogeneous registry schemas, compat+hook revalidation, concurrent order/identity, falsy details, env-wrap identity isolation. |
| `packages/core/test/tool-boundary.type-test.ts` | corehost | keep | Compile-time @ts-expect-error contracts (typecheck-only; principle keeps type tests). |
| `packages/core/test/tools.test.ts` | corehost | rewrite | Dropped tool-name asserts that read the test helper's own list and a bash schema-key pin. Structured result and exit-code error kept. |
| `packages/demo/server/vercel/test/dispatch.test.ts` | svc | keep | Payload to external workflow/api start for head-given vs list-all-heads branches of @nyte-ai/vercel createVercelDispatcher, which has no test in packages/vercel. |
| `packages/demo/server/vercel/test/infrastructure.test.ts` | svc | keep | Failed dispatch -> duplicate admission -> run read from another PGlite host; one workflow drains queued follow-up. |
| `packages/demo/server/vercel/test/workflow.test.ts` | svc | trim | Dropped a `toBeDefined`. The ordering assert carries the case. `vi.mock` coupling stays; move to packages/vercel recommended. |
| `packages/desktop/benchmark/browser-runtime.electron.test.ts` | desktop | keep | Env-gated (NYTE_DESKTOP_BROWSER_E2E=1) real-Electron runtime proof: ref click lands on named element, typing submits, refs from before a cross-document navigation fail without acting, fresh (more in JSON) |
| `packages/desktop/benchmark/catalog.spec.ts` | desktop | keep | Playwright perf scenario (renderer retention with large catalog); excluded from vitest and no test command runs it; measurement, not regression coverage. |
| `packages/desktop/benchmark/markdown-lifetime.spec.ts` | desktop | keep | Playwright perf/retention scenario (completed Markdown disposal); not run by any test command. |
| `packages/desktop/benchmark/navigation.spec.ts` | desktop | keep | Playwright perf scenario (no blank frame on unvisited tab); not run by any test command. |
| `packages/desktop/benchmark/process-metrics.test.ts` | desktop | keep | Benchmark helper parsers: ps tree walk with RSS KiB→bytes, malformed row error, final macOS top sample summed for selected pids. Collected by vitest. |
| `packages/desktop/benchmark/session-status.electron.test.ts` | desktop | keep | Env-gated (NYTE_DESKTOP_E2E=1, built app) full-app journey: unread/running/failed marks, preload is not read, restore last session, review cards and interrupted command. Not in CI. |
| `packages/desktop/benchmark/startup.spec.ts` | desktop | keep | Playwright startup perf scenarios (empty Home, 50 workspaces, 160-turn restore, slow shell, unresponsive server); not run by any test command. |
| `packages/desktop/benchmark/streaming.spec.ts` | desktop | keep | Playwright streaming perf scenario (no remount/oscillation counters); not run by any test command. |
| `packages/desktop/benchmark/terminal.spec.ts` | desktop | keep | Playwright terminal lifetime perf scenarios (hidden output, scrollback teardown, PTY reaping); not run by any test command. |
| `packages/desktop/benchmark/transport.spec.ts` | desktop | keep | Playwright reconnect-after-stream-error perf scenario; not run by any test command. |
| `packages/desktop/benchmark/workspace-cycle.spec.ts` | desktop | keep | Playwright session/workspace cycling perf scenario; not run by any test command. |
| `packages/desktop/src/main/account.test.ts` | desktop | trim | Dropped one constant relation already implied by the literal scheme outputs. 18 cases kept. |
| `packages/desktop/src/main/adblock.test.ts` | desktop | keep | Literal block/allow decisions via a real filter engine: exception rule, main frame never blocked, cosmetic CSS scoped to host, paused host covers subdomains but not fakenews.example (more in JSON) |
| `packages/desktop/src/main/app-menu.test.ts` | desktop | rewrite | 4 to 3. Cmd+W now invokes the menu callback and asserts the literal `{kind:"action", action:"close-tab"}`. Cut the win32 row (same branch as linux) and label pins. |
| `packages/desktop/src/main/browser-policy.test.ts` | desktop | keep | webUrl scheme refusal (`file:`, `javascript:`) and RFC1918/intranet host classification with literal decisions. |
| `packages/desktop/src/main/browser-report.test.ts` | desktop | rewrite | Prompt-copy regexes replaced by an exact check that a hostile element name renders as one escaped line. Fence, forgery and cap tests kept. |
| `packages/desktop/src/main/browser-tools.test.ts` | desktop | keep | Real SDK + SQLite. Each test catches a different gate defect: nothing reaches the page before consent, read-only refuses writes on the wake path (same session) and the execute path (more in JSON) |
| `packages/desktop/src/main/cloudflared.test.ts` | desktop | keep | Stand-in process: token kept out of argv, TUNNEL_* env stripped, config/dir modes, loopback-only metrics and hardening flags (exact argv kept as security pin), verified-route gating (more in JSON) |
| `packages/desktop/src/main/connect-interop.test.ts` | desktop | keep | Decided against the journey merge of tests 1/2/4/5. Measured (/tmp/nyte-prune-desktop/interop-before.log): those four take 465, 500, 745, and 776 ms, about 2.5 s together, of a 28.9 s file (more in JSON) |
| `packages/desktop/src/main/connect-relay.test.ts` | desktop | keep | Real ws relay + loopback HTTP: header/status allow-list, redirect reset, credit-window flow control both directions, body limit aborts local request, mid-stream teardown, 13 framing (more in JSON) |
| `packages/desktop/src/main/connect-store.test.ts` | desktop | keep | Persistence/security: concurrent updates build on each other, fresh-store read and 0600 mode, failed write latches failed and leaves file intact, unparsable/wrong-version/public-key-only (more in JSON) |
| `packages/desktop/src/main/errors.test.ts` | desktop | keep | Redaction boundary: envelope rejection never constructs a host, validation issues carry no input values or property names, expected failures keep category/cursor floor without identifiers (more in JSON) |
| `packages/desktop/src/main/host-connect.test.ts` | desktop | rewrite | `assert.ok(readConnectConfig(...))` became a deepEqual on the parsed config. 31 lease, replay and offline-order tests kept. |
| `packages/desktop/src/main/host-github.test.ts` | desktop | keep | Real DesktopHost: GitHub runs in homedir, failing/throwing/healthy phases, telemetry carries only operation names (no SECRET stdout/stderr/paths/login), signIn on a signed-in account emits (more in JSON) |
| `packages/desktop/src/main/host-login.test.ts` | desktop | trim | Dropped two approve-after-cancel blocks that could not fail. The real late-approval path stays in its own test. 17 cases kept. |
| `packages/desktop/src/main/host-remote-access.test.ts` | desktop | keep | Real share over loopback: concurrent start returns one address, client drives desktop Home store, 401/403 token refusal, model prefs follow desktop, unfinished uploads refused through the (more in JSON) |
| `packages/desktop/src/main/host-remote-plugin.test.ts` | desktop | keep | Real plugin + stand-in cloudflared: refusals read from server, CORS only for the tunnel origin, claim notifies Settings, no token/secret/cloudflared output reaches renderer, revoke ends (more in JSON) |
| `packages/desktop/src/main/host-server.test.ts` | desktop | blocked-dirty | Dirty from cloud-session work. Candidates for its owner: an injectable deadline for the 16 s test, one weak `some(local)` line. |
| `packages/desktop/src/main/host-workspaces.test.ts` | desktop | trim | 38 to 37. Cut an IPC redaction case identical to errors.test, and parser details covered by host usage tests. Cross-review T2 removed a redundant `assert.ok(nyteError)` branch. D3 isolates `HOME` for all desktop tests. |
| `packages/desktop/src/main/ipc-transport.test.ts` | desktop | keep | Only proof that the production preload preserves rejected error category/cursor floor/correlation and watch callbacks across Electron contextBridge with no secret body. |
| `packages/desktop/src/main/session-directory.test.ts` | desktop | keep | Delegating rollup through grandchild (root's own run never counts), remove plus stale sweep cannot resurrect descendants, sweep evicts an unlisted child alone. Literal outputs. |
| `packages/desktop/src/main/shell-environment.test.ts` | desktop | rewrite | The Windows case could not fail (`mut/old-win.mts`). It now uses a working shell, so removing the win32 guard fails it (`mut/win-guard.mts`). |
| `packages/desktop/src/main/summary-diagnostics.test.ts` | desktop | trim | Dropped one assert on a value the test built itself. |
| `packages/desktop/src/main/terminals.test.ts` | desktop | keep | Real PTY: independent resize and exit code, ack-based backpressure without byte loss, idle/busy foreground detection, idempotent close/dispose, IPC schema refuses command (more in JSON) |
| `packages/desktop/src/main/update-controller.test.ts` | desktop | keep | State machine literal sequence: download failure published then retried on next check, progress, ready, install only on restart. |
| `packages/desktop/src/main/update-relaunch.test.ts` | desktop | keep | Completed/failed(message)/timed-out outcomes of bounded relaunch cleanup. |
| `packages/desktop/src/main/usage.test.ts` | desktop | rewrite | Failed-store case now asserts the literal source rows instead of repeating errors.test redaction. Should move to packages/host. |
| `packages/desktop/src/main/workspaces.test.ts` | desktop | keep | Not covered by host/test/workspace-store.test.ts: legacy .nyte/sessions.db WAL imported once and retained after project deletion, missing/non-directory projects get separate stores without (more in JSON) |
| `packages/desktop/test/update-packaging.test.ts` | desktop | rewrite | Test 1 now requires stderr to name `NYTE_SPARKLE_PUBLIC_KEY`. Brand literals became a relation: every installer name equals a plain productName, and the local build's name differs. |
| `packages/host/test/codex-usage.test.ts` | corehost | rewrite | `cost > 0` became the exact catalog cost `0.000272`. |
| `packages/host/test/delegation.test.ts` | corehost | trim | 8 to 7. Cut the per-call model case: core subagents.test asserts the provider request model per delegation. |
| `packages/host/test/environment-id.test.ts` | corehost | keep | Concurrent first reads converge on one v4 id; corrupt id fails closed and is not replaced. |
| `packages/host/test/environment.test.ts` | corehost | keep | Sign-in flow state machine: prompts, browser link+code, refresh failure still connected, owner abort scope, supersede ordering, logout after stop, close, 5-minute forget. |
| `packages/host/test/environments.test.ts` | corehost | trim | 4 to 3. Cut the provider-opened success case: core workspace-activation asserts it with real tool effects. Host wiring still proven by the failure case. |
| `packages/host/test/git.test.ts` | corehost | rewrite | Outside-path refusal now leaves a tracked change and asserts no commit landed. Cross-review: git does the refusing, so the test can't fail for a Nyte defect. The subdirectory-workspace bug D1 is now fixed and covered by "workspace opened at a repository subfolder". |
| `packages/host/test/github.test.ts` | corehost | keep | Argv payloads and URL sanitization; leak checks for SECRET/evil across classify, sign-in and PR create; device sign-in process sharing/cancel. |
| `packages/host/test/host.test.ts` | corehost | rewrite, cross-review | Dirty in the prune, so not edited then. Cross-review fixed the fixtures of `:117` (long cache tier) and `:757` (plugin written before relocating), and T1 removed the count-above-5 line. No assertion loosened. |
| `packages/host/test/mention-files-install.test.ts` | corehost | keep | Propagates unusable ripgrep install directory (ENOTDIR). |
| `packages/host/test/mention-files-process.test.ts` | corehost | keep | Cancel kills process, failure propagates exit code+stderr, pre-cancelled rejects. |
| `packages/host/test/mention-files.test.ts` | corehost | keep | Git ignore semantics, nesting, negation, .git exclusion, symlink refusal, protected home, ranking literals. |
| `packages/host/test/model-preferences.test.ts` | corehost | keep | Damaged file parsing, change merge semantics, serialized concurrent writes on disk. |
| `packages/host/test/otel.test.ts` | corehost | keep | Export off without endpoint (ignores OTEL env), endpoint path resolution, nested span parentage over real HTTP. |
| `packages/host/test/plugin-sources.test.ts` | corehost | keep | ESM reload by content, canonical roots, cached failures, assets, host modules, watcher hold/release, duplicate watch merge. |
| `packages/host/test/plugins.test.ts` | corehost | keep; HOME stub, cross-review | Directory lists encode precedence order. Cross-review D3 added a `HOME` stub, because the fixture loaded the real `~/.agents/skills` and `~/.claude/skills`. |
| `packages/host/test/ripgrep-binary.test.ts` | corehost | keep | Resolution order, version probe bounds, SHA256 verification, selective extraction, HTTP body bounds/cleanup, shared install cancel/dedupe (security + supply chain). |
| `packages/host/test/ripgrep.test.ts` | corehost | keep | Hidden/ignore enumeration without symlinks, byte offsets, literal option-like patterns, stdin search, partial read failures, cancellation, JSON bound. |
| `packages/host/test/store-usage-scan.test.ts` | corehost | keep | Incremental rescans, removed session forgotten, unopenable store is a failed row. |
| `packages/host/test/tree-snapshot.test.ts` | corehost | rewrite | Outside-path restore asserted only `kind: failed`. It now puts a real file at `../escape.txt` and asserts it survives. |
| `packages/host/test/usage.test.ts` | corehost | keep | Claude usage dedupe/identity/pricing/tier/malformed/streaming/root resolution/symlinks/cancel/cache literals; cache encode/decode round-trip relation. |
| `packages/host/test/workspace-files.test.ts` | corehost | keep | Save conflicts, path escape and TOCTOU swaps (security), search bounds/encoding/ignore, blame porcelain, formatter selection/limits. |
| `packages/host/test/workspace-store.test.ts` | corehost | keep | Concurrent trust writes preserved; trust asked only with project input; always/never modes. |
| `packages/mobile/test/account.test.ts` | svc | trim | 16 to 15. The origin refusal matrix moved to connect's client test. Copy-table pins removed. `releaseCopy` branch logic kept. |
| `packages/mobile/test/connection-store.test.ts` | svc | keep | Stored-connection restore refuses foreign relay URLs (17 cases), other broker/no policy; abort mid-write rollback; failed undo serves nothing; save-then-remove ordering. |
| `packages/mobile/test/connection.test.ts` | svc | trim | 11 to 9. Cut 2 regex checks on a pure copy switch (`describeHostError`). |
| `packages/plugin/test/bash-description.test.ts` | ai-plugin | keep | 2 cases. Description offered as optional param, trimmed into the shell class; blank omitted. |
| `packages/plugin/test/codemode.test.ts` | ai-plugin | keep | 6 cases. QuickJS inventory/search/describe, hidden tools, policy passes through nested calls, store/load persistence only on success, late tool registration, truncation file 0600 and (more in JSON) |
| `packages/plugin/test/fast-mode.test.ts` | ai-plugin | blocked-dirty | Dirty from other work. Reviewed, all 5 cases keep: the toggle reaches the provider and survives restart. |
| `packages/plugin/test/mcp.test.ts` | ai-plugin | blocked-dirty | Dirty from other work. Reviewed 30 cases against real stdio/HTTP servers. The `:293` timeout did not reproduce in this pass's baseline. |
| `packages/plugin/test/notifications.test.ts` | ai-plugin | keep | 2 cases. Parked question and finished turn notify with sound following setting; off and child chats silent. No other coverage. |
| `packages/plugin/test/openai-astra-context.test.ts` | ai-plugin | blocked-dirty | Dirty from other work. Candidate for its owner: shrink the 4-case override matrix to 2. |
| `packages/plugin/test/openai-compaction.test.ts` | ai-plugin | rewrite | Fallback usage asserts `summaries.length * 30` instead of `> 0`. The 31 s Codex deadline test stays (see the plugin note in the second-pass section). |
| `packages/plugin/test/question.test.ts` | ai-plugin | trim | 17 to 16. Cut the free-text reply case: same reply, wake and `answerFor` path as the first case, and the `answerFor` unit case asserts trimmed text. |
| `packages/plugin/test/rename.test.ts` | ai-plugin | trim | Dropped `maxTokens === 64`, a pin of `MAX_OUTPUT_TOKENS`. Title behavior and fallbacks kept. |
| `packages/plugin/test/web-search-routing.test.ts` | ai-plugin | keep | 26 cases. Consent, sticky routes across restart/sessions, 429-only keyed failover, no downgrade to anonymous, abort, assertPrivate redaction. |
| `packages/plugin/test/web-search.test.ts` | ai-plugin | trim | Dropped the 401 and 503 segments (2 workspace opens). web-search-routing covers the same mapping. 429 stays as the only real-provider status pass-through. |
| `packages/protocol/test/sse.test.ts` | svc | keep | SSE parser by chunk shape: split frames, split UTF-8, CR/LF/CRLF, BOM, bounds per frame/line/id across chunkings, encoder round trip. |
| `packages/protocol/test/tool-state.test.ts` | svc | keep | Wire schema invariants with positive controls: illegal tool states unrepresentable (exit 0, success w/o commit, waitingFor on settled), shell facts shape, settlement vs forbidden legacy (more in JSON) |
| `packages/serve/test/environment.test.ts` | svc | rewrite | Baseline failure fixed: the catalog test now asserts `defaults.model`. The PR argv removal was wrong (a drop-`draft` mutant passed). P1 is applied: title and `--draft` asserted, 4 of 4 pass. |
| `packages/serve/test/tailnet.test.ts` | svc | keep | 100.64/10 edges, stopped/logged-out daemon unavailable, candidate CLI paths, unreadable output. |
| `packages/server/test/compaction.test.ts` | svc | keep | Snapshot during in-flight compaction and SSE order start -> checkpoint -> finish through real client/server. |
| `packages/server/test/environment.test.ts` | svc | keep | Info environment flag + released-client schema compat, 13-op dispatch round trip with recorded inputs, unknown_operation without env, input checked before handler, permission policy (more in JSON) |
| `packages/server/test/node.test.ts` | svc | trim | 7 to 6. The cut 401/origin case is covered elsewhere, but it never tested DNS rebinding. Approved fix F2 adds 1 test: rebound `Host` gets 403, same-origin gets 200. |
| `packages/server/test/wire.test.ts` | svc | trim | 37 to 36. Cut a live-watch ordering case that two other tests assert. Cross-review F3: the heartbeat test passes with heartbeats off. Approved fix adds a keepalive assertion. |
| `packages/telemetry/test/memory.test.ts` | svc | keep | File unchanged; executed cases drop via conformance.ts. Own test: no-op context admits synchronously and turns throws into rejections. |
| `packages/telemetry/test/otel.test.ts` | svc | keep | File unchanged; cases drop via conformance.ts. Own tests: failing backend start/record/end cannot change callback results. |
| `packages/tui/src/composer-mentions.test.ts` | tui | delete | Deleted in the prune. It copied host `mention-files-process.test.ts`, which still runs. |
| `packages/tui/src/composer.test.ts` | tui | delete | Deleted. tui step 10 covers the exact `<shell>` block for simple output. Not covered: special-character escaping, bang recall, clipboard NUL stripping. |
| `packages/tui/src/keymap.test.ts` | tui | delete | Deleted. Not covered: selection and copy (the QA clipboard is stubbed), late picker results, tree loading, panel scrolling. |
| `packages/tui/src/local-shell.test.ts` | tui | delete | Deleted. tui step 10 covers output as context and Esc. Not covered: process-tree, orphan and setsid kills, the overflow log, launch failure, signals. |
| `packages/tui/src/plugins.test.ts` | tui | delete | Deleted. tui step 2 loads a plugin. Not covered: plugin setup abort, late-effect fencing, cleanup budget. |
| `packages/tui/src/run.test.ts` | tui | delete | Deleted. headless step 5 covers model selection, and ai `github-copilot-catalog` covers the catalog. Not covered: the Copilot launch fallback and signed-out `/login`. |
| `packages/tui/src/settings.test.ts` | tui | delete | Deleted. tui steps 7, 12 and 14 cover the saved model and level. Not covered: scroll policy, project overrides, foreign-key preservation. |
| `packages/tui/src/timeline.test.ts` | tui | delete | Deleted. tui steps 5 and 6 cover paging, the wheel and resize. Not covered: turn navigation, anchors, virtual-window selection, tiny-size layout. |
| `packages/tui/src/tool-card.test.ts` | tui | delete | Deleted. tui step 4 renders a bash card. Not covered: exit, duration and failure wording, child outcome labels. |
| `packages/vercel/test/lifecycle.test.ts` | svc | keep | Close runs after a failed advance. |
| `packages/vercel/test/outbox.test.ts` | svc | keep | PGlite reopened from disk: crash-before-dispatch recovery, late admission never settled, failure rotation, overlapping reconcilers dispatch once, settle only after successful wake. |
| `packages/vercel/test/sandbox.test.ts` | svc | trim | Dropped a `provider.kind` pin and id/cwd echoes of the fixture. argv kept: it is the payload to an SDK that can't run locally, and the separate path argument keeps it out of the shell string. |
| `scripts/dependency-docs.test.mjs` | svc | keep | Boundary/security with positive controls: physical version selection, inert malicious entry (marker never written), escaped doc/type/manifest paths, C1 controls, no ancestor fallback. |

Edited or deleted support files outside the name pattern:

| Path | Scope | Disposition | Reason |
|---|---|---|---|
| `packages/app/test/appearance.fixture.ts` | app | trim | Dropped the `blur(12px)` design-token pin. Composition relations kept. |
| `packages/app/test/scope-performance.fixture.ts` | app | delete | Deleted. Nothing imports it and it asserts nothing. |
| `packages/app/e2e/server/address.ts` | app | blocked-dirty | Dirty from the first pass and another agent. Support file, not edited. |
| `packages/app/e2e/server/start.ts` | app | blocked-dirty | Dirty from another agent. Support file, not edited. |
| `packages/core/test/kernel/helpers.ts` | corehost | blocked-dirty | Dirty support from other work. Not edited. |
| `packages/plugin/test/host.ts` | ai-plugin | blocked-dirty | Dirty support from other work. Not edited. |
| `packages/telemetry/test/conformance.ts` | svc | trim | Shared suite run by memory and otel. 13 to 9 cases (26 to 18 executed). The cut cases are asserted inside the kept error and settlement cases. |
| `packages/tui/src/interactive.ts` | tui | blocked-dirty | Product source, dirty from other work. Read for caller context only. |
| `packages/desktop/src/main/fixtures/isolated-home.ts` | cross-review host | new | D3 setup file. Gives each desktop test file its own temporary `HOME` before imports and clears inherited home overrides. |
| `packages/desktop/vitest.config.ts` | cross-review host | edited | D3 adds `setupFiles`. The `runtimeInjection` removal in the same file is another agent's StyleX work. |
| `packages/tui/qa/` | tui redesign | rewritten | Two scenarios, `headless.ts` and `tui.ts`. 6 case and journey files deleted. 4,884 to 3,075 lines. |
