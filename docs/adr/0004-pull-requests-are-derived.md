# 0004. A chat's pull requests are derived from its branch and its own calls

Status: accepted, 2026-10-25. Answers question 8. Comparison rows: T3 Code D6; Cursor D6; PR agents D6.

## Context

Nothing in Nyte's store says which chat opened which pull request. `GitHubPullRequestContext` describes only the PR of a workspace's checked-out branch (`packages/schema/src/github.ts:48-53`), read on demand with `gh pr view <branch>`, and the app polls it every 15 s only while a check is pending and only for the open workspace (`packages/app/src/chrome/github-account.ts:17`). The sidebar treats every chat as having no PR (`packages/app/src/chrome/sidebar-view.ts:257-280`).

Agents open PRs with `gh pr create` in bash, not through Nyte's `createPullRequest` (`packages/core/src/contract/workspace.ts:118`). The store holds 15 such calls, and every one printed the URL: they map 19 PRs to 5 chats (#2 aea16535; #15 ea1a7169; #17–#18 bc4d680c; #19–#21 25e38e5a; #22 and #24–#34 7af0e645). Branch matching alone would have missed most of them, because the stack's branches were pushed by plumbing from a shared checkout and match no chat's worktree.

T3 Code stores a list of links per thread with a source (manual, created, agent, stack, stack-dismissed) and discovers each branch's PR every minute while a client is focused; its users report stale PR state (#4970, #8640), which a stored copy invites.

## Decision

A chat's pull requests are derived, not stored:

- **By branch.** A lane unit is one family, one worktree and one branch (ADR 0002), so the open PR whose head is that branch is the unit's PR. The watch's one poll per repository finds it.
- **By its own call.** For chats from before lanes, or a family that pushed a branch no worktree has out, the PR is the one whose URL a `gh pr create` call of that family printed. The settled call event already holds that output; the export reads it today.
- Dragging a chat in adds no link: its PRs are whatever the two rules above find for it.

Agents keep opening PRs with `gh pr create`; nothing new is needed for a chat to know its PR, and no record can disagree with the branch that names it.

Submitting and reviewing: in a lane the reviewer commits and opens the PR, the watch sees it on its next tick and the babysitter's trigger fires (ADR 0006). The human reviews that PR after the lane's reviewer has approved; a change asked for there goes to the unit's root session (its reviewer, or the chat that was dragged in), and a GitHub review comment reaches the babysitter as a dispatch.

Outside a lane, the same derived links, the watch, "Babysit this PR" on a model the user picks, and restore (ADR 0003) work for any chat. Rules and triggers that start new work are lane-only.

## Consequences

- The view can show each chat's PR and its checks without asking GitHub per chat; one poll per repository refreshes every link.
- The red stack's fifteen PRs derive to the one coordinator chat that opened them (#22 and #24–#34 to 7af0e645, #19–#21 to 25e38e5a), which is what the user needs to see when they ask what a chat is holding up.
- Reading `gh pr create` output is the fallback for families that pushed a branch no worktree has out, as the stack coordinator did; inside a lane the branch is enough.
