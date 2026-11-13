---
name: correct
description: "Find the mistakes agents keep repeating in this repo and make each one impossible. Try architecture first, then types, then a lint whose error names the fix, then a test, and write docs last. Prove each check fails on a real past mistake. Repeat this each time the operator corrects you. Use for /correct. Not for checking what one diff could break (blast-radius) or reviewing a diff's design."
disable-model-invocation: true
---

# Correct

Assume agents read only the files they open, copy the nearest example and take the shortest compiling path.

- Find classes (mistakes seen twice) in recent commits, reverts, review comments, AGENTS.md files and workaround comments.
- Architecture: one owner per piece of state, one way per task, internals hidden so wrong imports fail, one source of truth replacing hand-synced lists, no dead code to copy.
- Types: make the bad state unwritable. Failing that, a check whose error names what to use instead and, where the pattern is already common, fails only on additions.
- Tests: fix or delete any that would pass if every function it calls returned nothing.
- Docs: only for judgment calls.
- Fix the most frequent classes now, one commit each. Wire checks into `pnpm lint` or another script `pnpm check` runs.
- Exceptions: `// oxlint-disable-next-line <rule> -- <reason>`, with an expiry date and a human's approval. `nyte-code/require-suppression-reason` checks only the reason.
- Record each rule in the AGENTS.md that owns its topic (root for code style), ending with its enforcer, like `(lint: nyte-code/no-of-lookup-names)`. Register a lint rule in `oxlint.config.ts` before citing it, or `node scripts/check-agents.mjs` reports it as naming a location.
- On each correction, fix the mistake and add its rule. A rule that existed unenforced is a repeat: fix it at the highest level that works, in the same change. Drop a rule once its mistake can't happen.

Reply with each class, its evidence, the level picked and why no higher level worked.

## Not covered

- How a human's approval of an exception is recorded.
