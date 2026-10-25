# 0006. One trigger contract: a model-free watch, one owner per event, a dispatch log, budgets and stop rules

Status: accepted, 2026-10-25. Answers questions 7 and 11. Comparison rows: PR agents D4, D10; Cursor D4; T3 Code D4; Assistants D4; Linear D4.

## Context

The brief's trigger is "a PR for X fires 'babysit this until Y on model Z', so a typecheck fix doesn't burn my main model". Today the main model does the waiting: 203 Opus 5.5 turns read the output of a `gh` checks or runs query ($15.30), 617 Opus turns read the output of a command that slept ($69.53), and in chat 25e38e5a the user stopped a max-thinking Opus loop with "do not babysit pr". Waking a long chat is the expensive part: its context is re-read on every wake, and after the cache expires it is written again (about $4.80 for a 600k-token Opus chat at $8 per million one-hour cache writes; Cursor staff on a 5-minute timer that woke one agent about 474 times: "each wake runs the full conversation").

A local host gets no webhooks. Nyte polls GitHub only from the app, every 15 s, only for the open workspace and only while a check is pending (`packages/app/src/chrome/github-account.ts:17`). Plugins cannot run outside a session (`packages/core/src/extend/activation.ts:13-38`).

Others' rules: Cursor stops CI follow-ups at 10 per PR, on a human commit, after a user message, or when the same check already fails on the PR's base commit, and nothing documents who owns an event several agents subscribe to ("Who handled an event depended on who happened to be listening"). Factory's CI Steward analyses one head SHA once, caps a PR at 10 runs, diagnoses only when the same workflow failed on the base commit, and waits 15 minutes for checks to settle. CodeRabbit allows 3 repair rounds by default. T3 Code polls every 2 minutes and gives up after 10 comment-only wakes or 8 failed reads. Rakazo's watch runs no model, polls every 5 minutes or more, fingerprints what it watches, treats the first check as a baseline and starts a run only on change. Claude Code's loops run at least a minute apart and expire after 7 days.

The red stack shows what a contract must get right: all 18 open PRs fail `pnpm format`, and every failure is inherited. Main fails it on two files; #15 and #17–#28 fail on the same two, #29–#34 on one of them. Fourteen of the PRs are stacked, so their CI merges them into the PR below, not into main.

## Decision

A trigger is a lane rule: **when** an event from a source matches, **then** an owner acts on a pinned model, **until** a stop condition, **within** a budget. The babysitting trigger reads: when a pull request opens for a branch this lane's work owns, babysit it on `openai-codex/gpt-6.1-sol` (thinking low) until it is merged, closed or ready to merge, within 3 attempts, $2 and 7 days.

**Source and interval.** One `gh` query per repository per tick returns every watched PR's head SHA, base SHA, checks with their run ids, unresolved review threads, review decision, mergeability and state. A tick runs every 60 s while any watched PR has a pending check or was pushed in the last 15 minutes, and every 5 minutes otherwise. Nothing runs while the Mac sleeps or is offline; waking runs one tick, never the missed ones.

**Events without a model.** Each tick is diffed against the previous observation of the same PR: pushed, check settled (all checks for a head reached a terminal state), check failed, review thread opened, review submitted, base moved, merged, closed. A PR adopted while red yields its current failures on its first observation.

**Identity and dedupe.** An event's key is a hash of repository, PR, kind and subject (head SHA, check name and conclusion; thread id; review id; base SHA). Observing the same state again yields the same key, and the dispatch log holds each key once, so restarts, overlapping ticks and the next poll of an unchanged stack deliver nothing.

**Exactly one owner.** Every active watch owns one PR, and a PR has at most one active watch. A failed check is inherited when the PR's base commit fails the same step on a superset of the same files (matching by step and files, not by job name, so #15's `CI/check` matches main's `CI/verify`): it is routed along the base chain to the first base that is not itself inheriting, and the owner of that base (the lane's keeper for `main`) receives it. A failure that two or more PRs hit on their own is a family and goes to the keeper too. A PR's own failure goes to its babysitter. Questions for the user are deduplicated by cause across the lane, so eleven PRs failing one policy check produce one question.

**Decisions.** A dispatch is ignored (not actionable, or not a check the lane gates on), woken (start one babysitter run with a short message naming what changed), routed (inherited), asked (needs the user: ready to merge, a restack, a budget hit, a human push) or stopped. Only "woken" starts a model.

**What the lane gates on.** "Ready" means every check in the lane's gate passed on the head commit, no review thread is unresolved, and the PR is mergeable. The gate comes from the repository at setup; GitHub requires no checks on `main` here, so the Polish lane starts with the `CI` and `Changesets` workflows, and a check whose fix is a policy choice (Changesets) is asked about once for the lane instead of fixed per PR.

**Budget and stops.** Per babysat PR: 3 fix runs, $2 on the babysitter model, 7 days. Per lane: $15 a day and 20 watched PRs. A watch stops on merge or close; asks the user when ready (merging stays the user's call), when the budget runs out, when the same check fails after 3 attempts, or when someone outside the lane pushes, which also pauses it; and expires after 7 days.

**Mechanical remedies.** A lane may name a remedy that needs no model for a failure it recognises exactly, such as running `oxfmt` on the files a format check lists. A base fix that is mechanical runs as a command and a commit; anything else is a babysitter run.

## Replayed on the red stack (the lab's "Red stack" scenario, from the export)

- First tick: 18 PRs observed, 29 failed checks, 31 dispatches. The 18 `pnpm format` failures are inherited: #15, #17, #18 and #19 from main's commit `eafb6abbb`, and each stacked PR from the PR below it, back to main. The 11 `Changesets/status` failures are not main's (main runs no such check), but three stack roots fail it on their own, so they form one family. Both causes route to main's keeper, which acts once per cause: the format fix runs as a command (`pnpm exec oxfmt packages/desktop/e2e/settings.spec.ts scripts/nightly-release.mjs`, one commit, one PR to main), and Changesets becomes one question, because `origin/main`'s RELEASING.md asks every PR for a changeset while the user's AGENTS.md and #29 drop them. Per-PR fixes: 0. Model runs: 0.
- Second tick, nothing changed: 0 new keys, 0 dispatches, 0 model runs.
- After the user answers (drop Changesets from the gate) and the format fix merges: #15, #17, #18 and #19 see their base move, and one question asks to rebase the 15-PR stack onto main (one operation; the old heads stay kept). The lane's own pushes are recognised and start nothing. Each PR's next CI run then shows only what it still fails, and only those wake a babysitter.
- What the replay cannot know: CI has not passed on this repository in 154 runs since Sep 15, so no PR has ever run lint, typecheck, build or tests in CI. On Oct 22 main's own run got past format and failed unit tests on macOS, Linux and Windows. If that still holds, it is main's failure too: one more dispatch to the keeper, not 18.

## Consequences

- The main model never waits on CI; a wake costs one small Sol context instead of a long Opus one.
- The dispatch log answers "why did this run start" and "who handled that event" for every run a trigger caused.
- Inherited failures are fixed once where they start, so a red base no longer multiplies into per-PR fix attempts.
- The contract names nothing about git or PRs except in the GitHub source and its event kinds, so other sources can use the same owner, key, budget and stop rules (ADR 0009).
