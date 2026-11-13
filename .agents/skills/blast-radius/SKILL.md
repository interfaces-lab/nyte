---
name: blast-radius
description: "Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust. Not for reviewing the diff's own design or style, or for listing its callers."
disable-model-invocation: true
---

# Blast radius

Find the breakage outside the diff that grep won't show. A writeup that sounds right is convincing whether or not it's true, so the deliverable is a proven fact, not prose.

## Proof ladder

Get each fact the change's safety depends on as far down this list as is cheap, and say which step it reached.

1. You said so. Worthless on its own.
2. You pointed at a real `file:line` or the library's own source.
3. You walked the failure step by step and showed it can't reach.
4. You ran a script or test that calls the real code and fails loud if you're wrong.
5. You reproduced it in the running app.

## Steps

1. Read the diff, the PR description and the commits that touched these lines. Note what the change now does that the diff doesn't spell out.
2. Find the one fact it's safe because of, like "this call only drops already-dead cache entries and does nothing else". If it holds, most risky cases clear at once. Spend your time here, not on a long list of maybes.
3. Look where grep stops. Read the source of the library you call at its pinned version, with any local patch (`patchedDependencies` in `pnpm-workspace.yaml`). Work out when things run: microtasks, unmount and teardown, Solid in the TUI versus React in the app. Follow what a symbol search misses: the JSON an API returns, a DB column, a wire format, another language reading the same bytes, a feature flag, code three hops downstream.
4. Give each risk a real chance and a real cost. Keep confirmed risks apart from the ones you cleared. Cite a real `file:line`; a search that finds nothing is still an answer. Never make up a caller or an API.
5. Prove the one fact, usually with one small script that imports the library the app ships and calls the exact function you're worried about. Run it and paste what happened.
6. For a big or wide change, get a second independent review (another agent or a person) on the same question and merge the answers.

## Reply

- **What it does.** What changed, including the part that isn't obvious.
- **The one fact it's safe because of.** State it, the ladder step it reached, and the proof. If you couldn't prove it, write unproven.
- **Risks.** Each names how it breaks, the `file:line`, how likely, how bad, and how to check. Paste the proof for the ones that matter.
- **Cleared.** What you checked and why it's fine.
- **Before you merge.** The cheapest test or repro that catches the real bug, including the script you wrote.

Write it through `unslop`, and strip anything private before it goes anywhere public.

## Not covered

- What makes a change big or wide enough to need the second review.
