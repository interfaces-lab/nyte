---
name: review-principles
description: "Review a diff, branch, PR, or design sketch against engineering principles: deletion before addition, reader load, domain modeling, boundaries, types, idempotency, shared state, legacy APIs, root causes, tests, and proof. Use when asked for a principles review, 'review this against the principles', or when a change needs a structural review rather than a style pass."
---

# Principles review

Review a change against the `principle-*` skills in this pack. Every finding names the principle it applies and the change it asks for. A principle cited with no concrete change behind it is name-dropping. Leave it out.

## 1. Scope

Find what to review, in this order:

- The files, diff, or PR the user points at.
- Otherwise the current branch against its base (`git diff <base>...HEAD`) plus uncommitted changes.
- For a design sketch instead of code, review its types, signatures, and module map as if they were the diff.

Write the intent of the change in one paragraph, taken from the user's message, the commit messages, and the PR description. If you can't tell what the change is for, ask before reviewing.

Read each touched file in full, not just the hunks, and read the callers of every changed export. A hunk hides the shape around it.

## 2. Pick the principles

Walk the index against the diff. Load a principle only when its trigger matches something actually in the diff. Write one line naming the principles you loaded and one line naming the ones you skipped, so a wrong pick is cheap to catch.

| Principle | Load when the diff | Reference |
| --- | --- | --- |
| Laziness protocol | adds a layer, wrapper, or abstraction, threads a new flag through several layers, or is bigger than the problem it solves | [principle-laziness-protocol](../principle-laziness-protocol/SKILL.md) |
| Subtract before you add | builds on code that still carries dead paths, stubs, or redundant validators | [principle-subtract-before-you-add](../principle-subtract-before-you-add/SKILL.md) |
| Redesign from first principles | fits a new requirement in as a special case instead of reshaping the design around it | [principle-redesign-from-first-principles](../principle-redesign-from-first-principles/SKILL.md) |
| Minimize reader load | adds one-caller wrappers, pass-through layers, or module-level and global mutable state | [principle-minimize-reader-load](../principle-minimize-reader-load/SKILL.md) |
| Model the domain | grows an if/else chain, adds a boolean that must stay in sync with another, or repeats a shape assumption across files | [principle-model-the-domain](../principle-model-the-domain/SKILL.md) |
| Foundational thinking | introduces core types or data structures, or state that more than one actor touches | [principle-foundational-thinking](../principle-foundational-thinking/SKILL.md) |
| Boundary discipline | adds validation, parsing, error handling, or a framework adapter, re-validates internal data, or exports wire types | [principle-boundary-discipline](../principle-boundary-discipline/SKILL.md) |
| Type system discipline | adds types, optional fields, casts, `any`, non-null assertions, unhandled variants, or a hand-written copy of a schema type | [principle-type-system-discipline](../principle-type-system-discipline/SKILL.md) |
| Make operations idempotent | adds a command, lifecycle step, migration, job, or retry loop that mutates state | [principle-make-operations-idempotent](../principle-make-operations-idempotent/SKILL.md) |
| Separate before serializing shared state | has two actors writing one file, key, branch, or object, or adds a lock | [principle-separate-before-serializing-shared-state](../principle-separate-before-serializing-shared-state/SKILL.md) |
| Migrate callers then delete legacy APIs | adds a new API beside an old one, or an adapter, shim, or deprecated path | [principle-migrate-callers-then-delete-legacy-apis](../principle-migrate-callers-then-delete-legacy-apis/SKILL.md) |
| Fix root causes | fixes a bug by adding a guard, nil check, try/catch, retry, or a workaround that needs a long comment | [principle-fix-root-causes](../principle-fix-root-causes/SKILL.md) |
| Attack the premise | is the second or later fix for the same failure | [principle-attack-the-premise](../principle-attack-the-premise/SKILL.md) |
| Test behavior, not implementation | adds, changes, or keeps tests | [principle-test-behavior-not-implementation](../principle-test-behavior-not-implementation/SKILL.md) |
| Prove it works | claims the change works, or the PR says "tested" or "verified" | [principle-prove-it-works](../principle-prove-it-works/SKILL.md) |
| Explain the number | reports a speedup, regression, latency, throughput, or eval result | [principle-explain-the-number](../principle-explain-the-number/SKILL.md) |
| Encode lessons in structure | fixes a mistake the codebase has made before, or you're about to write a review comment you've written before | [principle-encode-lessons-in-structure](../principle-encode-lessons-in-structure/SKILL.md) |
| Experience first | changes a public API, CLI, UI, or anything else a consumer touches | [principle-experience-first](../principle-experience-first/SKILL.md) |

## 3. Review

Apply each loaded principle's tests to the diff. A finding has four parts:

- **Where.** `path:line`.
- **What.** What the code does now, in one sentence.
- **Principle.** The one it breaks, by name.
- **Change.** What to delete, move, merge, or retype. Be concrete enough that someone could make the edit without asking.

Prefer findings that delete code over findings that add it. When two principles produce the same finding, report it once under the one that explains it better.

Confirm every finding in the code before reporting it. Open the file and count the callers, find the second writer, or name the missing variant. If you can't confirm it, drop it or turn it into a question.

## 4. Report

Order the findings by how much they change:

1. Design: ownership, data model, boundaries, shared state.
2. Deletions: layers, paths, wrappers, and tests that can go.
3. Everything else.

Skip cosmetic nits when design findings exist. A few findings you're sure of beat a long list of maybes.

| Where | What | Principle | Change |
| --- | --- | --- | --- |
| `src/sync.ts:42` | `retryCount` and `isRetrying` must stay in sync | Model the domain | Replace both with one `{ kind: "idle" } \| { kind: "retrying"; attempt: number }` field |

End with a verdict and one line on why: ship, ship after the listed changes, or rethink the shape.

"No findings" is a complete review. Say which principles you checked so the user can see what was covered.

Don't fix anything unless asked. When asked, fix the design findings first, because they often make the smaller ones disappear.

For a harsher structural pass, follow with `review-code-quality`.
