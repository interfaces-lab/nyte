---
name: architect
description: "Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use when asked to architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape."
disable-model-invocation: true
---

# Architect

Design before implementing. Sketch types, function signatures, class shapes, and module boundaries with `not implemented` bodies and pseudocode. Synthesize across several independent candidates, then fill in code against the chosen sketch. If implementation proves the sketch wrong, throw it out and redesign.

## Start

Track the five phases as a checklist (your tool's todo list if it has one, otherwise a list in your reply).

1. Ground
2. Sketch
3. Agree
4. Implement
5. Scrap

## Phase A: Ground the problem

Build a real mental model of every system the new code touches. Explore each relevant subsystem and explain how it works: its runtime flow, who owns what, and where each piece lives in the layering.

Naming a file isn't grounding. Produce a traced model with file and line references. If the design redefines ownership or layering, also investigate why the existing shape is the way it is, using blame, commit history, PRs, and docs, so the rationale becomes a constraint, not a guess.

Skip Phase A only when the work is genuinely greenfield with no surrounding system to integrate.

## Phase B: Sketch

Produce independent candidates for the design sketch. If your tool can run parallel sub-agents, give one candidate to each (on different models when available); otherwise draft them yourself one after another, without rereading the earlier candidate while writing the next. Give each, each with the Phase A grounding artifacts. Pass `references/runner-prompt.md` as each runner's prompt. Each candidate produces a design package shaped per `references/rationale-template.md`.

Design it twice. Require at least two structurally distinct candidates before synthesis, even when the first looks sufficient. Whole-shape alternatives, not point fixes inside one shape.

Screen every candidate against [`references/design-red-flags.md`](references/design-red-flags.md) before synthesis. Assume the next contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Prefer the design where a change that looks right from one file is right for the whole repo.

Compare viable candidates on interface depth. Prefer the design that hides more complexity behind a smaller, simpler public surface. A rich interface can keep call chains short by concentrating capability instead of scattering it across layers.

Read every candidate end to end, pick the strongest as the base, and graft the best ideas from the others into it. The result is one synthesized design package. The synthesis decision populates the rationale's "Synthesis decision" section.

## Phase C: Agree (opt-in)

Default: proceed directly to implementation with the synthesized design. No human checkpoint.

Opt in to a checkpoint when the invoker explicitly asks: "architect with checkpoint," "stop and show me before implementing," or similar. Then surface the synthesized design and pause for sign-off.

The synthesis can ship as its own commit either way, as a scaffold that lands before the feature work. Planned and scoped breakage during fill-in is fine. For adversarial pressure on the design before implementing, have independent reviewers (different models or fresh sessions, if available) challenge the synthesized sketch from independent angles.

If the human pushes back on the shape (in a checkpoint or after the fact), treat that as Phase A evidence. Re-ground and re-run Phase B before writing more code.

## Phase D: Implement against the sketch

Replace `not implemented` bodies with code, pseudocode with logic. The synthesized sketch is the contract.

Deviations from the sketch are signal worth surfacing, not friction to absorb silently. If a function needs a parameter the sketch didn't anticipate, ask whether the sketch was wrong, the requirement was missed, or the implementation is overreaching.

## Phase E: Scrap when the architecture is wrong

If implementation keeps producing friction the sketch can't absorb, throw the sketch out. Don't bolt fixes onto a wrong design. Fix the root cause.

The signal is a *pattern*, not single instances. Tells:

- The same shape of workaround appearing repeatedly across unrelated code.
- Multiple unrelated edge cases that all need special-case branches.
- Types that need escape hatches (`any`, casts, optional fields always set in practice) to compile.
- The "we need a lock" reflex when the sketch said the state wasn't shared.
- Callers having to know the abstraction's internal rules to use it.
- Two or more independent Phase D deviations of the same shape across the implementation.

Use judgment. A few edge cases don't condemn an architecture. Some problems are legitimately complex. Complexity in the data is not complexity in the design.

When you scrap:

1. Re-ground on what's been built, as in Phase A.
2. Redesign as if the new constraints had been day-one assumptions.
3. Subtract before adding. The new sketch should be smaller than the old one before it grows.
4. Return to Phase B and re-run the candidates.

## Outputs

The caller's usage is written first and the type sketch derived from it. One file with new types and signatures for small changes. Module map plus type definitions for larger work. The rationale ships alongside, shaped per `references/rationale-template.md`, including the usage sketch and the synthesis decision.
