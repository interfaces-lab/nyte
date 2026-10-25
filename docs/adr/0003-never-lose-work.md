# 0003. Never lose work: only a checkout's writer changes it, and every change it makes ends in a kept snapshot

Status: accepted, 2026-10-25. Answers question 12. Comparison rows: T3 Code D8; Cursor D8; Assistants D8.

## Context

Nyte already snapshots everything: a snapshot is a git tree of the tracked and untracked, non-ignored files, written through a temporary index and kept reachable for good under `refs/nyte/kept`, in generation trees of 1,000 (`packages/host/src/local/snapshots.ts:93`). Every run records the snapshot it started from and its newest one (`packages/core/src/contract/records.ts:110-112`). 5,421 snapshots are kept today.

The Oct 24 wipe was therefore recoverable in one step, yet nobody used it: `SnapshotsApi` can take, diff and patch snapshots but not restore one (`packages/core/src/contract/workspace.ts:238-248`), so fifteen chats rebuilt their edits from transcripts. The wiping run's record still names `git:07ac00efd46a041bd2bd375d12e2d1a9c7445b70`, kept in generation `g000005`. Rebuilding the five wiped files from it into `/tmp` gives four files byte-identical to today's shared tree; `packages/app/src/queries.ts` differs by 18 lines, and applying chat ca87552f's edit of 18:53:07, 22 minutes after the wipe, to the rebuilt file yields today's file exactly. So the restore equals the hand rebuild, plus later work.

What snapshots cannot fix is a change nobody owns. With several chats in one checkout the tool runner records shell changes as `unattributed` (835 calls since Oct 21), and a restore of one chat's files would overwrite another's.

T3 Code shows the opposite failure: deleting a thread's worktree passes `force: true` with no dirty check, and its automatic cleanup deleted a nested worktree that sat under an ignored path, uncommitted work included (#23866).

## Decision

The rule, checkable by one query over calls, writer leases and kept trees:

> Only a checkout's writer changes it, and every change it makes ends in a kept snapshot.

A violation is a call that changed files in a checkout while its session did not hold that checkout's writer lease, or whose after-snapshot is not kept. A rewrite of a pushed branch (a restack) counts as a change: the old head stays reachable under `refs/nyte/kept`.

Following from it:

- **Restore** is an action on a session: pick a kept snapshot and paths, take a fresh snapshot first (so the restore can itself be undone), then write those paths from the snapshot into the session's own checkout. Only the writer may restore. A dry run writes into a temporary folder instead.
- **Release** may remove a worktree with uncommitted changes only when its newest snapshot is kept and recorded and nothing the removal deletes is outside that snapshot, except what the repository rebuilds (`node_modules`, `dist`, `.turbo`). Snapshots leave ignored files out (`packages/host/src/local/snapshots.ts:93`), so a folder holding any other ignored file, such as an `.env`, or a nested worktree or repository, is kept, as it is today. Today's release keeps every dirty folder (`packages/core/src/env/worktrees.ts:96-147`), which is why 28.3 GB sit in `~/.nyte/worktrees`.
- Deleting a worktree with `force` without a final kept snapshot is never allowed.

## How today's evidence reads under the rule

- **Oct 24:** the wiping call changed files in a checkout with nineteen would-be writers and no lease, so it is a violation, as is every one of the 835 unattributed calls. Inside a lane the same command runs in 7af0e645's own worktree: it is that chat's writer call, its after-snapshot is kept, and the only work it can wipe is its own, restored from its own before-snapshot.
- **The red stack:** every PR's work is a pushed commit, so nothing is at risk; the one rewrite the plan proposes, restacking fifteen branches onto a fixed main, keeps all fifteen old heads.
- **The eight worktrees:** each has one owner, so the writer half holds; but isolation copied 1,029 files that are not their owners' (against 55 of their own). Under the rule nothing is copied in, every worktree's newest snapshot holds exactly its owner's work, and removing a merged or snapshotted worktree loses nothing.

## Consequences

- One chat's mistake can no longer cost other chats their work, and its own mistake costs one restore.
- Disk can be reclaimed without asking, because "dirty" stops meaning "only copy".
- Shell calls still run unsandboxed; the rule detects a non-writer's change after the fact and the view flags it, but only isolation (ADR 0002) prevents it.
