---
name: blast-radius
description: "Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust. Not for reviewing the diff's own design or style, or for listing its callers."
disable-model-invocation: true
---

# Blast radius

## Proof ladder

A writeup that reads well proves nothing, and neither does a list of callers. Push each fact the safety rests on as far down as is cheap, naming the step reached, and prove the one that matters by running code.

1. Asserted. Worthless alone.
2. A real `file:line` or the library's source.
3. A step-by-step walk showing the failure can't reach.
4. A script or test on the real code that fails loud if wrong.
5. A repro in the running app.

## Steps

1. Read the diff, PR description and commits behind these lines.
2. Find the one fact it's safe because of, like "this call only drops already-dead cache entries and does nothing else". If it holds, most risks clear; spend your time here, not on maybes.
3. Look where grep stops:
   - library source at its pinned version, plus any local patch (`patchedDependencies` in `pnpm-workspace.yaml`)
   - timing: microtasks, unmount and teardown, Solid (TUI) versus React (app)
   - API JSON, DB columns, wire formats, other languages reading the same bytes, feature flags, code three hops downstream
4. Cite only real `file:line`s, callers and APIs. A search that finds nothing is still an answer.
5. Prove the one fact, usually by running a script that imports the shipped library and calls the exact function in question.
6. For a big or wide change, merge in an independent second review (agent or person) of the same question.

## Reply

- **What it does**, including what the diff doesn't show.
- **The one fact**, its ladder step and pasted proof, or "unproven".
- **Risks**: how each breaks, `file:line`, likelihood, severity, how to check, pasted proof for those that matter.
- **Cleared**: what you checked and why it's safe.
- **Before you merge**: the cheapest test or repro that catches the real bug, including your script.

Run it through `unslop`. Strip private details before publishing.

Why code is the way it is belongs to history (`git log`, `git blame`). This skill is for what a change breaks elsewhere.

## Not covered

- What counts as big or wide enough for a second review.
