---
name: grill
description: Grill the user relentlessly about a plan, design, decision, or idea, a round of numbered questions at a time with a recommended answer for each, until every decision is settled. Use when the user says grill me, stress-test this, poke holes, or wants to sharpen a plan before building. Add "with docs" to also record decisions as ADRs and a glossary.
disable-model-invocation: true
---

# Grill

Interview the user until you reach a shared understanding. Map it as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are settled: the questions you can ask now without guessing at answers you haven't heard. Ask the whole frontier in one round, number each question, and give your recommended answer. Then wait.

```
❓ **Q1** - **<question title>**: <question body, choices if any>

➡️ <your recommended answer>

---

❓ **Q2** - ...
```

Each answer reshapes the tree. Recompute the frontier and ask the next round. A question that depends on another question still open this round belongs to a later round.

Facts are your job, never the user's. When a question needs a fact from the environment (files, history, docs), look it up yourself, in a background sub-agent if your tool has them. Don't block on it: only the questions downstream of that lookup wait; ask the rest now. Decisions are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch visited, nothing silently assumed. Don't act on the plan until the user confirms you share the understanding.

## With docs

When the user asks to grill "with docs" (or wants decisions written down), keep two files current as rounds settle, in the project's docs location (ask once if there is none; default `docs/`):

- `docs/adr/NNNN-<slug>.md`, one per settled decision that would be expensive to reverse: Context, Decision, Alternatives considered, Consequences. Write it when the decision settles, not at the end.
- `docs/glossary.md`: every domain term the session pinned down, one line each, using the user's words. When two words turn out to mean one thing, pick one and list the other as an alias.

Name the files you wrote at the end of each round.
