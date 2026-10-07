# Desktop demand-loading experiment

Run from the repository root with the installed pnpm dependencies and Node 26:

```sh
pnpm exec node --conditions=nyte-source packages/lab/performance/directory.ts
pnpm exec node --conditions=nyte-source packages/lab/performance/git.ts
```

Both commands create synthetic data in temporary directories, assert actual results, print JSON, and remove their fixtures. No server, model request, personal session, dependency install or production source change is needed.

Read [FINDINGS.md](FINDINGS.md) for the traced causes and architecture decision. The `research/` directory preserves the GPT-6.1 Sol investigations of Nyte, Pierre and installed Cursor Glass, with source references and raw synthetic measurements. Architect compared two different read designs; principles review checked the synthesis and source claims.

## What the code demonstrates

### Directory

[`directory.ts`](directory.ts) compares the real core SDK with one relational query over the same SQLite database. The query joins current name/archive/pin/parent fact refs. It returns a distinct compact row, not a fabricated `SessionInfo`. Returned fact bodies pass core shape/hash validation. A fact ref whose object is missing, hash-mismatched or not a blob drops that one row, as core list does; the script asserts this for a dangling `archived` ref and a tampered name. No history is needed to list those facts.

The query reads authoritative refs directly and keeps no derived state. It is evidence that these four fields need no history, not evidence for any maintained projection.

Default fixture: 180 sessions, 14 children, 256 real content-addressed commits per session.

| Operation | Session opens | History commits returned | SQL calls |
| --- | ---: | ---: | ---: |
| Current core cold list | 180 | 46,080 | 4,557 |
| Current core warm list | 0 | 0 | 361 |
| Compact fact query | 0 | 0 | 1 |
| Current core list after archiving one row | 0 | 256 | 386 |
| Compact fact query after archive | 0 | 0 | 1 |
| Current core list, fresh SDK over persisted listing rows | 180 | 0 | 1,663 |

The cold row is a store with no listing rows. Once `a3536dc2` listing rows exist, a fresh SDK reads no history; history reads remain for missing or invalidated rows. The 256 commits after archiving rebuild the archived row and then filter it out of the default list. Warm core list and fact query wall times are both about 2 ms in this fixture, so the table shows removed work, not a latency win.

The script verifies explicit names, pin/parent values, root/child filters, real SDK archive visibility, rename, unpin, restore, corrupt-fact row isolation, and a fresh SDK instance using the existing persisted listing rows. It also re-checks existing behavior the query does not own: core's repeated-archive idempotency and the store's CAS rejection. Those cannot fail because of a projection defect, since there is no projection. A fresh SDK is not a database close/reopen test.

The SQL statement count measures statements executed through the connection. Rows returned are not rows visited internally. The compact query still reads fact objects, 13,520 returned body bytes in the default initial query. It does not claim zero database work or indexed bounded pagination.

Important limits: it omits preview-derived titles, activity ordering, run/question status, workspace, activation, config, pagination and search. Filtering happens before validation, so excluded corrupt facts are not checked; parent filtering assumes valid stored parent facts. This is a real-core demonstration of history independence, **not the complete proposed transactional directory projection**.

A larger history, same session count:

```sh
pnpm exec node --conditions=nyte-source packages/lab/performance/directory.ts 1024
```

### Git

[`git-manifest.ts`](git-manifest.ts) lists changed paths using Git's NUL-delimited name/status output. [`git.ts`](git.ts) then calls the existing real `createGitVcs().diff` with explicit selected paths and parses only those returned patches using the installed Pierre parser.

The essential caller change is:

```ts
const { manifest } = await readGitManifest(cwd, oid);
const selected = await backend.diff({
  cwd,
  scope: manifest.scope,
  paths: [selectedPath],
  ignoreWhitespace: false,
});
```

The file tree gets `manifest.files`; it does not wait for `selected` or for every patch in the commit. The current host still repeats full scope discovery for the selected read. The demo removes unnecessary patch acquisition, not all repository work. `readGitManifest` is a lab copy of the host's internal `nameStatus` that only accepts modified files. Production should expose the host's existing scope discovery, not port this parser.

Default fixture: one two-commit repository, 180 modified text files, 40 replaced lines per file, one selected file.

| Result | Files represented | Patch bytes | Files parsed |
| --- | ---: | ---: | ---: |
| Metadata manifest | 180 | 0 | 0 |
| Current whole-commit diff | 180 | 696,060 | 180 |
| Explicit selected diff | 1 | 3,867 | 1 |

The manifest's paths and statuses equal the current backend's full result. The selected patch is byte-for-byte equal to the corresponding current-backend patch; both come from the same `git show <oid> -- <path>`, so this is a sanity check that path filtering changes nothing, not proof of a separate payload path. The script also asserts added/removed counts, parsed paths and line counts. No patch-result memoization was added.

In the default fixture the full synchronous parse of 180 files takes about 5 to 7 ms, while the full backend read takes hundreds of milliseconds of subprocess work. The measured saving is acquisition, not parsing.

Arguments are files, lines per side, selected files and trial count. The demo caps file count at 512 because the baseline deliberately exercises today's subprocess fan-out.

```sh
pnpm exec node --conditions=nyte-source packages/lab/performance/git.ts 180 40 4 3
pnpm exec node --conditions=nyte-source packages/lab/performance/git.ts 1 100000 1 1
```

The second command is a deliberate counterexample: demand loading alone does not solve one enormous selected file. It still reads/parses that body. Production also needs a byte gate during collection, explicit deferred/too-large results, cancellation and off-renderer parsing where warranted. This demo supports modified ASCII files in single-parent commits only. It does not implement all Git scopes, rename/binary semantics, new protocol operations, viewport integration or a desktop performance fix.

## Recorded verification

Independent default executions are retained in [`results/directory.json`](results/directory.json) and [`results/git.json`](results/git.json). `results/directory.json` predates the corrupt-fact check; [`results/directory-boundary-check.json`](results/directory-boundary-check.json) is a later run of the current script with identical counters. The verified [single-large-file counterexample](results/git-single-large-file.json) returned the same 10,555,715 patch bytes for both full and selected reads. Their wall times are single-run fixture observations, not speedup or desktop-FPS claims. The counts above describe removed work and have behavioral assertions behind them. The earlier research has three-trial data with caveats about uncontrolled machine load.

Checks:

```sh
pnpm exec tsc --noEmit -p packages/lab/performance/tsconfig.json
pnpm exec oxlint packages/lab/performance/directory.ts packages/lab/performance/git.ts packages/lab/performance/git-manifest.ts
pnpm exec oxfmt --check packages/lab/performance
```

## What should change in production

1. Preserve sidebar hover prewarming. The initial removal was an overcorrection and has been reverted in full, including neighbor warming. Cursor explicitly preloads the hovered composer. The unresolved fix is to constrain speculative reads and stop child/directory queries from hydrating unrelated sessions, not remove navigation latency work. No sidebar change is included in this commit.
2. Remove history reads that only fact changes cause before adding durable state: `refreshRow` hydrating a row after archive, `rowHolds` treating fact ref events as full invalidation, and hydrating rows that a fact filter then excludes. Measure those with the counters here. A store-owned read model for preview, all-head status and question semantics is a later option this demo does not justify; if built, migrate all store writers and callers, then delete the current read-time listing repair path.
3. Count-only patch reads are removed from the collapsed rail and working-tree scope-menu rows. They now show file counts from existing Git status, not +/- line totals. The selected scope's toolbar totals still come from the panel's patch read. Viewport-demand loading for the changes stack remains unimplemented; keep Pierre's existing virtualized viewer and tree when addressing it.
4. Treat a giant selected patch as a separate bounded-input problem. A worker or another cache does not make unlimited input safe.

The production dependency table and remaining risks are in [FINDINGS.md](FINDINGS.md). The independent reviews are [OPUS-DEMO-AUDIT.md](OPUS-DEMO-AUDIT.md) and [OPUS-IMPACT-AUDIT.md](OPUS-IMPACT-AUDIT.md). The retained production changes cover five Git UI files, plus three existing scope-test files. The sidebar deletion described in the historical audits was reverted after the user challenged it and Cursor's hover preloading was traced directly. No core, host, protocol, bridge or storage contract changed; pre-existing edits in touched files were preserved.

Combined verification: app and demo typechecks, both default demos, targeted lint/format, and seven focused workbench test files with eleven tests pass. The scope-menu regression observes zero additional patch reads on opening the menu, correct file counts, and one read plus a rendered patch after selecting another working scope. The auditor's full app run had five failures in four unmodified test files; no baseline established whether they predated these edits. No live desktop responsiveness measurement was made.


Pre-commit recheck after restoring sidebar prewarming: the eleven focused tests, demo typecheck, scoped lint and formatting pass. The app-wide typecheck now reports `HostBridge.start`/`starts` and registry journal API errors in `screens/thread.tsx`, `web/bridge.test.ts` and `web/registry.test.ts`, outside this change. Those in-progress files were left untouched.
