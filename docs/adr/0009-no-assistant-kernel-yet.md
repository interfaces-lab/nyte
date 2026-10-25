# 0009. No assistant kernel yet: build the lane, keep the trigger contract free of coding types

Status: accepted, 2026-10-25. Answers questions 16 and 19. Comparison rows: Assistants D1–D10; Cursor D1.

## Context

The earlier research argued for extracting a shared core first: a standing agent with triggers on a pinned model, durable runs, and sign-in on demand, with the coding lane as its first user. The verified comparison tests that.

The same mechanism under different names:

| Assistant | Lane |
|---|---|
| A bot or profile with instructions (Rakazo `Bot`, Hermes profiles) | A lane with rules |
| A routine or listener with its own model | A trigger with the babysitter's model |
| A watch that runs no model and starts a run only on change (Rakazo: 5-minute floor, a SHA-256 fingerprint, the first check only a baseline) | The PR watch and its dispatch keys |
| Memory documents | Skills and ADRs the rules point to |
| A connect card for sign-in mid-task (Rakazo's never resumes the waiting run, issue #1967) | MCP `needs-sign-in` |
| Spawning a peer bot vs a one-turn helper | A babysitter session vs a subagent |
| Run leases, effect idempotency keys | Head leases, snapshots, dispatch keys |

Different in kind:

- **Isolation.** Assistants share one computer or home per user (Grok Bot: "do not use separate Bots as a security boundary"); a lane needs one exclusive checkout per writer.
- **End states.** A PR is opened, checked, reviewed, merged or closed; an assistant's work has no end state.
- **Verification.** CI, tests and a reviewer model can check a lane's work; an assistant's mostly cannot be checked.
- **Coding is delegated out** by Rakazo, Grok Bot and Dots, to Cursor or Codex cloud agents; none runs coding work as its own unit.

What the others would add on top of the contract: a personal assistant adds channels (email, messages, Slack), personal memory with consolidation, and approvals per action (Muse's Sentinel); a workflow adds deterministic steps with no model, of which the lane's mechanical remedies are the smallest case; a meeting-notes recorder adds an audio source and writes documents; a second brain adds a memory store and retrieval.

## Decision

Build the lane now and no assistant kernel. The trigger contract (source, events, key, owner, decision, budget, stop, dispatch log) names no git, PR or CI type in its interface; those live in the GitHub source and its event kinds. Extraction waits for a second consumer that needs host-level triggers.

## Consequences

- Workflows, a meeting-notes recorder and a second brain each wait (ADR 0010); none blocks the lane.
- The lab's trigger types are the contract a second consumer would read first.
