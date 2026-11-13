---
name: correct
description: "Find the mistakes agents keep repeating in this repo and make each one impossible. Try architecture first, then types, then a lint whose error names the fix, then a test, and write docs last. Prove each check fails on a real past mistake. Repeat this each time the operator corrects you. Use for /correct. Not for checking what one diff could break (blast-radius) or reviewing a diff's design."
disable-model-invocation: true
---

# Correct

Change the repo so the next agent can't repeat a mistake the operator keeps correcting. Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. A change that looks right from one file must be right for the whole repo.

## Find the classes

Read recent commits, reverts, review comments, the AGENTS.md files and comments that explain workarounds. Group the mistakes into classes. A class counts once it has happened twice.

## Fix each class at the highest level that works

1. **Architecture.** Give each piece of state one owner and each task one supported way. Hide internals so the wrong import fails. Replace hand-synced lists with one source of truth. Delete old ways and dead code an agent would copy.
2. **Types, so the bad state can't be written.** If bad code still compiles, add a lint or CI check whose error names the file, type or function to use instead. If the pattern is already common, fail only when a change adds more.
3. **A test of the behavior.** Fix or delete any test that would still pass if every function it calls returned nothing.
4. **Docs or agent rules, last and only for judgment calls.** Nothing fails when an agent skips them.

## Fix and prove

1. Fix the most frequent classes now, one commit each.
2. Prove each new check fails on a real past mistake.
3. Wire it into `pnpm lint` or another script `pnpm check` runs, so local and CI run the same command.
4. Put an exception on the offending line as `// oxlint-disable-next-line <rule> -- <reason>`, with an expiry date and a human's approval. `nyte-code/require-suppression-reason` enforces the reason. Nothing checks the date or the approval.

## Keep the rule table

The rule table is the AGENTS.md that owns the topic, the root one for code style. Each rule ends with what enforces it, like `(lint: nyte-code/no-of-lookup-names)`. Register a lint rule in `oxlint.config.ts` before you cite it, or `node scripts/check-agents.mjs` reports the citation as naming a location.

When the operator corrects you, fix the mistake and add the rule. If the rule was already there and nothing enforces it, that's a repeat, so fix it at the highest level in the same change. Drop a rule once its mistake can't happen.

**Reply:** each class with its evidence, the level you picked, and why a higher level didn't work.

## Not covered

- How a human's approval of an exception is recorded.
