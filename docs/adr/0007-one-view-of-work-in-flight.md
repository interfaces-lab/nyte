# 0007. One view of work in flight, derived from records; every other list is a filter of it

Status: accepted, 2026-10-25. Answers questions 5, 8, 11, 12 and 13. Comparison rows: T3 Code D1, D2, D8; Cursor D2, D6.

## Context

Work in flight is spread over four places today, each partial. The sidebar lists top-level chats only (`packages/app/src/chrome/sidebar-view.ts:248-255`) and treats every chat as having no PR (`:257-280`); its `pr`, `branch` and `machine` show fields are menu items with nothing drawn. Subagents appear only in transcript cards and the Agents tray. The workbench shows the PR of the open folder's branch only. Worktrees appear nowhere: eight of them hold 28.3 GB and 1,029 files that are not their owners'. The red stack's 18 PRs, all opened from two chats, are visible only on GitHub.

T3 Code's sidebar is the best prior art: one flat list of threads from every project, a status computed first-match-wins (approval, input, request, waiting, working, idle, limited or failed, ready), a PR badge, and branch and worktree as row attributes. It shows no CI or uncommitted state on rows and hides subagent threads; its users report the sidebar looking idle while a PR watch runs (#15924) and stale PR state (#4970, #8640).

The user never steers a subagent directly: 0 messages typed into 275 of them, though "Open as full chat" exists (`packages/app/src/conversation/tray/agents.tsx:283`).

## Decision

**One list, derived.** A pure function over the records (sessions and their families, worktree owners, the PRs derived for them, observations, dispatches, snapshots, runs) yields the rows; nothing in the view stores state of its own. The rows are work items, not chats: a branch of work with its writer chain (worker, reviewer, babysitter), its checkout, its PR and checks, its watch, and its spend. A row also exists for anything that holds work with no live owner: a worktree whose chat is gone, a pushed branch with no PR, a PR with no linked chat, a shared checkout with more than one would-be writer.

**Status, first match wins:** needs you (a question waits: ready to merge, a restack, a budget hit) → failing (an own failure the babysitter has stopped on) → working (a run in progress) → watching (a watch waiting, no model running) → ready (gate passed, mergeable) → idle (uncommitted or unpushed own work, nothing running) → merged. The status is computed from records on read, so it cannot drift from them.

**Grouping.** By lane, then "No lane" for chats with work in flight outside any lane, so normal chats get the same view.

**One point of view.** The sidebar's chat list, the Agents tray, the PR list and the lane panel are filters of the same rows (Needs you, Running, PRs, Worktrees). None keeps its own copy; a second place cannot disagree because it is not a second source.

**Steering.** Every row opens its session as a full chat with a composer; the writer chain's sessions are one click each. Review comments from GitHub reach the babysitter as dispatches; a comment that needs a decision goes on to the unit's root session: its reviewer, or the chat that was dragged in. A ready row opens its diff for your review, the step after the lane's reviewer approved.

**The wow moment, timed.** Drag chat 25e38e5a (it opened #19, red at `pnpm format` for 27 hours, and runs on Opus with 523k tokens of context) into Polish. At 0:00 the chat is in the lane, its three PRs are found and each gets a Sol babysitter. At 0:01 the first tick shows the failures are main's and a policy's, not #19's: the format fix runs on main as a command, and you are asked once about Changesets. At 0:02 you answer. At about 0:23 the fix's CI has passed (a full run took 20.1 minutes on Oct 22, verify alone 3.1) and you merge it; one question asks to rebase the stack. At about 0:44 #19's first full CI run is green and it asks to be merged. Model runs: 0. Spend: the cost of the CI minutes. The limit is real: if main's unit tests still fail as they did on Oct 22, #19 waits on main, the view says so, and the keeper gets one more dispatch.

## Consequences

- "Not losing work" becomes visible: a worktree, branch or PR with no owner is a row, not a folder on disk.
- The lab page is this view on real data; production builds the same derivation in the app over the same records.
- Rows need what ADRs 0002, 0004 and 0006 describe; until those exist, the export reconstructs them from the store, git and GitHub, which is what the lab shows.
