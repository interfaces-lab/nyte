# Bounded desktop reads

The production implementation keeps sidebar hover and neighbor prewarming. It changes what the backend reads, not which chats can be prewarmed.

## Implemented

- **Session rows:** `core/src/kernel/sdk/reads.ts` refreshes name, pin and archive facts without rebuilding unchanged history. Parent/archive filters run before history hydration. Content, run, effect, queue and ancestry changes still invalidate the row. `get` refreshes workspace, activation and leases. No new persistent projection was added.
- **Ownership:** the host-only `sessionRoot` replaces `sessionWorkspace`. Headless visibility checks read ancestry and workspace without ancestor histories, preserving the depth limit and fail-closed behavior.
- **Git metadata:** `workspace.vcs.changes` supplies file identities, rename sources and line counts. Untracked counts remain unknown until their patches arrive.
- **Git payloads:** `diff.paths` is required, with at most 16 paths per call. The backend permits four patch reads at once and caps each file's collected Git output at 2,000,000 bytes. Oversized and failed files have explicit outcomes. Empty demand starts no Git process.
- **Rendering:** while the stack shows, every expanded file is read in the background, one read in flight per panel and at most 8 paths per read. Each read takes rendered headers first, then mark-viewed requests, then unread files nearest the file in view, then stale stand-ins. Text parsing runs in a dedicated worker, and each read publishes once. Collapsed files are read only for mark-all; a hidden stack reads nothing new. Unread review marks remain unknown. Scope changes discard queued old demand and stale replies.

Untracked patch generation and line counting now run in Git, not synchronous JavaScript on the desktop host. The adapter uses collapsed native diff placeholders to preserve CodeView's scroll anchor. These remain `pending` in app state; they are not fabricated `VcsDiff` results.

## Runnable demos

From the repository root, with installed dependencies and Node 26:

```sh
pnpm exec node --conditions=nyte-source packages/lab/performance/directory.ts
pnpm exec node --conditions=nyte-source packages/lab/performance/git.ts
pnpm exec node --conditions=nyte-source packages/lab/performance/git.ts 1 100000 1 1
```

Both scripts use temporary synthetic data and remove their fixtures. They make no model requests or personal-session reads.

### Session directory

The default fixture has 180 sessions with 256 commits each.

| Operation | History commits before | History commits now | SQL calls now |
| --- | ---: | ---: | ---: |
| Cold list without stored rows | 46,080 | 46,080 | 4,557 |
| Warm list | 0 | 0 | 361 |
| List after archiving one row | 256 | 0 | 373 |
| Fresh SDK over persisted rows | 0 | 0 | 1,663 |

The archive case previously made 386 SQL calls. These are operation counts, not desktop latency measurements. Current output is retained in [directory-after-fact-refresh.json](results/directory-after-fact-refresh.json); [directory.json](results/directory.json) is the earlier baseline.

The script also compares a compact fact-only SQL query. That query omits preview, activity, run status, workspace, activation, configuration, search and pagination. It is not a replacement for `SessionInfo` or evidence for a new directory table. It validates returned fact objects but filters before validation, so excluded corrupt facts are not checked. A fresh SDK over the same connection is not a database reopen test.

### Git

The script calls the production manifest and bounded patch APIs. Reading all files uses sequential batches of 16; selected reads request only their named paths. Accepted patches are compared byte-for-byte, then parsed with the installed Pierre parser in Node.

| Fixture | Full patch bytes returned | Selected patch bytes returned |
| --- | ---: | ---: |
| 180 files, 40 replaced lines, one selected | 696,060 | 3,867 |
| One 100,000-line file | 0 | 0 |

The giant file returns `too_large`, and no returned patch is parsed. The demo separately obtains Git's uncapped control patch to verify its real size, 10,555,715 bytes. That control read means this script is **not** a peak-memory benchmark.

Current runs: [git-capped.json](results/git-capped.json), with four selected files and three trials, and [git-single-large-file-capped.json](results/git-single-large-file-capped.json). Earlier unbounded results remain in [git.json](results/git.json) and [git-single-large-file.json](results/git-single-large-file.json).

Reading every file now trades throughput for bounded work. Sequential batches repeat discovery, and line-count metadata costs more than names alone. Old and new wall times are not a controlled comparison: trial counts, selection size and machine load differ. No desktop speedup is claimed from these scripts.

## Behavioral proof

- `core/test/kernel/sdk-session-rows.test.ts`: fact refresh, concurrent content changes, trimmed history, parent filtering, lease/workspace freshness, corrupt facts and history-free roots. Runs against SQLite and WorkerStore.
- `serve/test/headless.test.ts`: ancestry reads and the existing depth admission rule.
- `desktop/src/main/host-workspaces.test.ts`: archiving does not release queued or delegated live work.
- `host/test/git.test.ts`: real Git scopes, byte equality, oversized output, per-file failures and subprocess start/exit counts. Concurrent calls peak at four patch processes.
- `app/src/workbench/changes-demand.test.ts`: real Electron/CodeView with a scripted bridge. Its 180-file tree exists before patch arrival. Collapsed files cost no reads until mark-all, which reads them in batches of at most 16. A fresh panel reads all 180 files in 23 reads of at most 8 without scrolling, and a far jump afterwards lands on bodies with no further read. A file revealed while a background read is held is first in the next read and stays at the top while files above it fill in. Frame-paced scrolling during preparation shows no content drift.
- `app/src/workbench/changes-patches.test.ts`: source replacement, release, bounded mark-all and omitted results.

```sh
NYTE_TEST_STORE=worker pnpm --dir packages/core exec vitest run test/kernel/sdk-session-rows.test.ts --maxWorkers=1
pnpm --dir packages/host exec vitest run test/git.test.ts --maxWorkers=1
pnpm --dir packages/app exec vitest run src/workbench/changes- src/workbench/change- --maxWorkers=1
pnpm exec tsc --noEmit -p packages/lab/performance/tsconfig.json
```

## Remaining work

- The first cold directory rebuild still walks history. Many-session metadata validation also remains.
- Git discovery and manifest numstat still scan the scope. Discovery runs outside the patch-process limit.
- No cancellation signal crosses IPC or HTTP. Old host reads finish; the app discards their results.
- Mobile reads all requested files in bounded batches rather than using viewport demand. Turn scopes still acquire all recorded patches up front; parsing follows the stack's read order.
- Pierre derives each item's height from its parsed diff and has no per-item height hint, so an unread file stays header-tall until read. The scrollbar grows while the review prepares, including above the viewport, where CodeView's anchor keeps visible content still. Scrolling upward into unread files right after opening can outrun preparation: in a real-input probe, 7 to 104 of about 640 frames showed header-only files, all within the first 1.6 s. Revision changes restart preparation; stand-ins keep their geometry meanwhile.
- The parser worker is a separate asset with a 30-second idle lifetime. The renderer test harness uses relative asset paths so it exercises that production loading shape.
- Commit caching assumes the full object IDs supplied by the app's log; the host still accepts revision expressions.
- No full-desktop FPS or large-repository click-to-paint claim has been established.

[FINDINGS.md](FINDINGS.md), [OPUS-DEMO-AUDIT.md](OPUS-DEMO-AUDIT.md), [OPUS-IMPACT-AUDIT.md](OPUS-IMPACT-AUDIT.md) and `research/` preserve the earlier investigation and rejected proposals. Their implementation-status statements describe that earlier stage; this page describes the current code.
