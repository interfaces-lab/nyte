# 0002. One chat writes a checkout at a time

Status: accepted, 2026-10-25. Answers questions 9 and 12. Comparison rows: Cursor D7; T3 Code D7; Assistants D7.

## Context

On Oct 24 at 18:31:03 a chat ran `cd /tmp/t3code && …; git checkout -- .; git read-tree -mu HEAD` (session 7af0e645, run 80f808c5). `/tmp/t3code` did not exist, so the `;` chain ran in the shared checkout `/Users/workgyver/Developer/nyte`. Nineteen chats had uncommitted work of their own there (their newest change events listed files), three were running that second, fifteen were told to redo their edits from their transcripts, and the recovery took 21 runs and about $60.

The tool runner could not even say whose work it was: when a shell call changes files while another chat is live in the same workspace it records `unattributed: true` and no paths (`packages/core/src/agent/tool-runner.ts:614-621`). Since Oct 21 that happened 835 times in 110 chats. The check also misses sharers: one checkout is registered as several workspaces (three records for the repository root, more for `packages/lab`, `packages/docs` and others), while `anotherChatLive` compares workspace ids (`packages/core/src/env/session-changes.ts:65-95`).

Isolation exists but is optional and copies the source's uncommitted changes in (`packages/core/src/builtins/delegation.ts:41-48`), so the eight live worktrees hold 20 to 162 files each that are not their owner's, against 0 to 17 of their own.

Cursor documents the same hole for local workers: "Nothing coordinates file edits between them". Git already refuses one branch in two worktrees, and the lab's own review server gives each author session a worktree of its own and leaves a branch checked out elsewhere alone (`packages/lab/server/review.ts:567-571` at `9c794659b`, removed with the lab's review page).

## Decision

A checkout has exactly one writer at a time.

- A checkout is a git working tree, keyed by its root, not by workspace id. Every workspace inside it shares its writer.
- The writer is one session family: a top-level chat and the subagents that share its folder, as `SessionRecord.parent` already groups them. A lane unit is one family (its reviewer, the Sol worker it delegates to, the babysitter it gets) in one worktree, and only one of the family's sessions runs there at a time. Other families may read the checkout, never change it; a `before_tool` guard refuses edit and write tools to them. Ownership ends only once the family's last write is held by something durable: a kept snapshot, a commit, or a pushed commit.
- Every chat a lane starts gets its own worktree on a new branch from `origin/main`, with nothing copied in. A chat dragged into a lane from a shared checkout gets a new worktree holding only the files its own calls changed.
- The user's shared checkout keeps working as today for chats outside lanes; the view shows when it has more than one would-be writer.

## Consequences

- Attribution becomes exact: a call's changes belong to the lease holder, so `unattributed` can no longer happen inside a lane.
- A destructive command can only destroy its own chat's work, and that work is in the chat's own snapshots (ADR 0003).
- Isolation stops copying uncommitted changes into worktrees made by a lane; the source's edits stay with their owners.
- The worker, the reviewer that commits and the babysitter that pushes are one family taking turns, so "who is writing this branch" always has one answer, and the view shows which of them runs.
