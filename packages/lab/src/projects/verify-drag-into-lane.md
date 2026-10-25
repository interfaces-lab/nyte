# Lanes: drag a running chat into a lane

A verify-nyte journey, written before the feature exists. When lanes move into the app it becomes
`.agents/skills/verify-nyte/features/lanes.md` and the desktop chapter `packages/desktop/e2e/lanes.spec.ts`.
Its steps are the lab scenario "Drag a running chat" (`world.ts`, steps `before` to `ready`), on the same data.

A user drags a chat that opened red pull requests onto the Polish lane. The chat keeps running and keeps
its transcript, model and folder; from its next turn it follows the lane. Each pull request it opened gets
a babysitter. The first watch tick shows the failure is main's, one fix runs on main as a command, one
question covers Changesets, and #19 ends ready to merge with no model run.

## Sub-features

- `join`: dropping the chat's row on the lane, or its row action "Move to Polish", sets the chat's main
  head agent to `lane.polish` with the model it already runs. Transcript and folder are unchanged.
- `notice`: before the chat's next turn, one lane notice appears in its transcript.
- `babysitters`: each open pull request the chat opened gets a child session running
  `lane.polish.babysitter` on `openai-codex/gpt-6.1-sol`; each shows in the unit's writers and the chat's
  Agents tray, and opens as a full chat.
- `watch`: the first tick routes inherited failures to the keeper; the unit reads "waits on one fix on
  main". No model request starts.
- `remedy`: the keeper's format fix runs as a command and opens one pull request to main.
- `ask`: one question about Changesets for the whole lane; the answer changes the lane's gate.
- `ready`: after the fix merges and the stack is rebased, #19 reads "Ready" and asks to be merged.

## How to get to it (user POV)

- Desktop: Settings › Developer › Lanes on. Create Polish from the setup form. In the sidebar, drag the
  chat onto the Polish group, or open the row's actions and choose Move to Polish.

## Driving it with Playwright

New chapter `packages/desktop/e2e/lanes.spec.ts` with `test.use({ chapter: "lanes" })`, the offline
scripted provider, and these fixtures in the chapter's temporary HOME:

- A git fixture: a bare `origin`, `main` failing `oxfmt --check` on `packages/desktop/e2e/settings.spec.ts`
  and `scripts/nightly-release.mjs`, and branches `view-queue`, `mark-chat-read`, `mobile-agents-doc`.
- A seeded chat titled "Investigate swallowed user messages in prod nyte db" whose transcript holds settled
  `gh pr create` calls printing pull requests 19, 20 and 21, so the PRs derive from its own calls.
- A fake `gh` first on PATH that answers `pr list --json …`, `pr view`, `run list` and
  `run view --log-failed` from a fixture copied from the lab export's red stack, and appends every command
  it receives to a log the test reads.
- The scripted provider's request log, to count model requests per session.

Steps, with the lab step each one matches:

1. `before`: expect the sidebar group "Polish" and its drop region
   `getByRole("region", { name: "Drop a chat on Polish" })`.
2. `drag`: drag `chatRow(page, "Investigate swallowed user messages in prod nyte db")` onto the region with
   `dragTo`. Expect the row under Polish, its writers to list three babysitters (`Babysit #19`, `#20`,
   `#21`), and the head's configuration to keep `anthropic/claude-opus-5-5`. Repeat with the keyboard path:
   focus the row, open its actions, press Enter on "Move to Polish".
3. Send "continue" in the chat. Expect the lane notice ("This chat is now in the Polish lane…") before the
   reply in the `Messages` log.
4. `tick`: advance one tick through the host's test hook, never by waiting. Expect a unit "Keep main green"
   whose why reads `pnpm exec oxfmt packages/desktop/e2e/settings.spec.ts scripts/nightly-release.mjs`, #19
   reading "waits on one fix on main", and the fake `gh` log holding exactly one `pr create --base main`
   and no push to `view-queue`, `mark-chat-read` or `mobile-agents-doc`.
5. Advance another tick with nothing changed. Expect no new dispatches and no new `gh` writes.
6. `answered`: expect exactly one "Needs you" question about Changesets; answer "Stop Checking Changesets".
7. `merged`: make the fake `gh` report the fix merged; advance one tick. Expect one question, "main moved to …
   Rebase the branches on it? Old heads stay kept.", and confirm it with "Rebase 3 Branches".
8. `ready`: make the fake `gh` report #19's checks passed; advance one tick. Expect the chat's row under
   Polish to read "Ready to merge" and the lane to ask "#19 is ready to merge.".
9. Across the journey, expect zero provider requests from `lane.polish`, `lane.polish.babysitter` and the
   keeper, and from the dragged chat only the reply to step 3.

Side effects to check after the run, read-only against the chapter's store: every dispatch key has one
owner (the lab's `ONE_OWNER` query from `sql.ts`), and every rewritten branch's old head is reachable
from `refs/nyte/kept` (the lab's `NEVER_LOSE_WORK` rule).

## Gotchas

- A local host gets no webhooks. Drive ticks through the host; a fixed sleep proves nothing.
- `gh` must be the fake on PATH inside the temporary HOME, or the chapter reaches GitHub.
- The drop region exists only while the developer setting is on.
- Drag is pointer-only; the keyboard path through the row's actions is part of the journey, not optional.
- The scripted provider answers instantly, so assert the absence of requests, not their timing.
