---
name: better-writing
description: Cut and tighten interface copy: captions that restate a label, hints that plant a worry, warnings left over from a fixed bug, empty states, toasts, confirmations, button text. Use when writing or reviewing any user-facing UI string. Prose style is unslop; CLI output is cli-ux.
---

# Better writing (interface copy)

Most bad copy isn't badly written. It's copy that shouldn't be on the screen, and editing it for tone just makes the wrong thing read better. So the first question is never "how should this be phrased". It's **should this exist**.

How text renders (case, quotes, wrapping) belongs to `better-typography`. Prose style in docs and messages belongs to `unslop`.

## The ladder

Walk a string down these in order. Stop at the first rung that fires and cut.

1. **Does this need to surface at all?** Would the user ever have wondered about it, unprompted? If not, you're planting a question, not answering one. A caption reading "the preview is rendered at the exact size used on your profile" makes them wonder whether it might not be.
2. **Does the label need to exist?** A caption earns its place only when the value is meaningless without it. "Retry limit" doesn't need "how many times we retry" beneath it. A bare "30" does need "seconds".
3. **Is it pre-empting something the user never had to consider?** The tell is copy that rules out a failure rather than describing a behavior: "Always keeps the files already transferred, never wipes the folder like the old cancel did." The fix for a fixed bug is the fix, not a caption about the fix. Same for copy defending a design decision or hedging about something that works.
4. **Rewrite to remove the offending part. If nothing is left, delete the element.** An empty `hint` prop comes off the component; an explanatory `<p>` gets deleted, not shortened to a stub.

## What survives

Copy stays when the user cannot act without it:

- A real consequence at the moment of choosing: "Anything not yet synced is lost." under a destructive button.
- A compatibility or scope fact they can't see: "Works with keys issued after March; older keys need rotating first."
- What a blank state means and what to do next: "No projects yet. Create one and it will appear here."
- Units, scale, or format on a bare value.

Keep the consequence, cut the permission slip. "Only use this when a sync is stuck" instructs users on when they may press a button they can already see.

## Working style

- Read the string next to what's on screen around it. Redundancy is invisible when you read the string alone.
- Cut whole clauses, not words.
- If a string matters only in a rare state, move it into that state.
- Errors name what failed and how to recover. Don't suggest a retry that can't help.

## Reporting

One row per string, failing strings only:

| Location | Current | Rewrite or `cut` | Rung |
| --- | --- | --- | --- |

`Location` is `path/to/file:line`. Don't rewrite copy that passes. With nothing to report, say "No actionable copy findings".
