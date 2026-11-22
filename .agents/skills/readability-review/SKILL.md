---
name: readability-review
description: "Review TypeScript in this repository the way a Google readability reviewer would: names first, then how each line reads to someone new to the file. A script checks the mechanical rules on changed lines; you judge the rest. Use when asked for a readability review, a naming review, \"how should I name this\", or to review a diff for style before commit. Not for architecture or behaviour; principle-review covers those."
---

# Readability review

A readability review asks one question of every line: will the next person read it right the
first time? Correctness and design belong to other reviews. This one teaches. Every finding says
what to change and why, in one sentence, so the author learns the rule instead of the fix.

## 1. Run the scan

```sh
node .agents/skills/readability-review/scan.mjs
```

It reports only lines changed against `HEAD`, untracked files included. Pass `--base <ref>` for a
branch, paths to narrow it, and `--whole` to audit whole files. Exit 1 means findings.

Each finding is a rule, not a verdict. Fix it, or say in the review why this line is the exception.
Real exceptions: a name that mirrors a wire format or an external API (`TSIndexSignature`,
`input_tokens`), a framework's required name, the TUI's `Msg`.

The scan covers the rules below; `pnpm lint` covers the rest of the mechanical style (braces, `interface` over object type aliases, `private` over `#`, type-only imports). Don't repeat either by hand; spend your attention on step 2.

| Rule | What it wants |
| --- | --- |
| `constant-case` | CONSTANT_CASE only for module-level `const` values nobody changes, never a function or a cache filled at runtime. A module-level literal is CONSTANT_CASE. |
| `acronym-case` | Acronyms as words: `userId`, `loadHttpUrl`, `HtmlParser`. Brand spellings `OpenAI` and `iOS` pass. |
| `abbreviation` | No words with letters deleted: `message`, `context`, `error`, not `msg`, `ctx`, `err`. |
| `short-name` | One-letter names only in scopes of ten lines or fewer. |
| `underscore` | No leading or trailing `_`. `_` alone and `_exhaustive` pass. |
| `type-in-name` | No type in a value's name (`itemsArray`, `nameString`) and no `I` prefix on interfaces. |
| `assignment-in-expression` | Assign in a statement. `??=` lazy init passes. |
| `destructuring` | Destructure several values or none: one value reads through dot notation. A destructured parameter is one level of shorthand names, with defaults on the left and `= {}` when optional. |

## 2. Judge the names

Walk each new or renamed symbol down this ladder. Stop at the first rung that fires.

**1. Does it name the domain thing, not its structure?**
`agent: provider.explicitOnly` gives one fact two names across a boundary; the reader now has to
learn both. Pick the one the domain uses and carry it through. Words like `data`, `info`, `item`,
`value`, `result`, `state`, `handler`, `manager` and `helper` say a thing exists, not what it is.

**2. Does it read right at the call site?**
A function is a verb phrase for what it does: `findModel`, `readChild`, `formatRef`. A value is a
noun. A boolean reads as a condition without a prefix: `if (closed)`, `if (owns(id))`, never
`if (isClosed)` (lint already bans `isFoo` helpers and `fooOf` lookups). A vague verb (`check`,
`settle`, `process`, `handle`, `sync`) needs the effect it has: `notifyIfMoved`, `invalidateAndBump`.

**3. Does it mean one thing in its scope?**
The same name for two things, such as a returned `sync` that queues and an inner `sync` that runs,
makes the reader track which one they are in. Rename the inner one for what it does: `runSync`.

**4. Is it as long as its scope needs, and no longer?**
A name lives as long as its scope. `i` in a three-line loop is right; `index` there is noise. A
module export needs the whole name, since its readers arrive from other files.

**5. Does it repeat its container?**
Inside `ModelCatalog`, `catalogModels` is `models`. Inside `workspaces.ts`, `workspaceName` is fine
only if the file holds more than one kind of name.

## 3. Judge the lines

After names, read each changed line once, cold:

- A condition that needs a second read: a nested ternary, a negated `if` with an `else`, a
  multi-clause condition with no name. Split it or name the rule it decides.
- A swallowed outcome: `() => undefined` as a rejection handler, `void promise`. Name why it is safe
  to ignore, through the handler's name.
- Order: the happy path first, its helpers below, early returns instead of nesting.
- An import or a type the reader has to chase to understand one line.

## Reporting

- One line per finding: `file:line`, the current text, the change, and the rule or rung in a few
  words. Example: `models.ts:762` `mine(id)` → `owns(id)`. Rung 2: reads as a condition.
- Educate, don't decree. Say why once per kind of finding, then list the other instances bare.
- Don't comment on what passes. Don't restyle lines the diff didn't touch.
- Group as: scan findings to fix, scan findings that are exceptions (with the reason), judgment
  findings.

## Promoting a rule

When `--whole` reports zero for a rule, it belongs in lint. Add it to `scripts/oxlint/nyte-rules.ts` (a
built-in rule, or a `nyte-code` rule for naming, since oxlint has no `naming-convention`), and
delete it from the scan and this table.
