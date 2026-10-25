# 0001. One concept, the lane: rules for a stream of work, standing or until a goal is met

Status: accepted, 2026-10-25. Answers questions 1, 2, 3 and 14. Comparison rows: Linear D1, D3; Cursor D1, D3.

## Context

The brief starts from "Project is where there is a decisive deadline". Two kinds of work came out of it. Nyte's polish work never ends: small fixes arrive one at a time and each follows the same rules (worker Sol, reviewer Opus, the same skills, one PR per fix). Shipping Nyte Projects does end: it has a target date, decisions, and tickets that close.

Linear has one concept for both and nudges it toward ending. Its FAQ answers "Can I make a project for ongoing work?" with "Technically yes … but we encourage projects to have a clear start and end", its schema keeps `ProjectStatus.indefinite` for statuses meant to last, and its own workaround for ongoing work is a custom Maintenance status. Cursor folds everything into one Project with a shared notes file, and users report notes "written 111 times and explicitly read once".

Everything the polish work needs, a goal needs too: the skills each role reads, the models, commit and PR rules, triggers and limits. A second concept for goals would copy all of it. What a goal adds is small: an end (a date and a definition of done) and a source of tickets.

The word "project" is taken. In Nyte it already means the trust-gated folder files (`projectSources`, `packages/core/src/contract/records.ts:227`), the AGENTS.md prompt section, an MCP scope and the sidebar's folder entries, and `docs/glossary.md` forbids it for a workspace.

## Decision

One concept, the **lane**: the rules a stream of work follows, and the work in flight under them. A lane has an `until`:

- **standing**: no end date, no progress, paused or archived by hand. Polish is a standing lane.
- **until a goal**: a date and a definition of done; done when its tickets close. Shipping Nyte Projects is such a lane.

Only standing lanes are built in this round. A goal lane's ticket source is Linear, whose Project is already one, so until Linear is connected (ADR 0010) "ship Nyte Projects" lives there and its decisions live here.

The user's flow lands in one lane: setup is the lane's rules; knowledge is the skills its roles read on every turn plus the decisions it points them to; decisions are ADRs in the repository, versioned and reviewed with the code and named in the lane's rules so its agents read the ones that apply, rather than a notes file nobody rereads; edge cases and tickets become work items when the lane has a ticket source; delegation, review, PRs and babysitting follow the rules.

The UI word is **Lane**. `Row`'s design docs say "leading lane" and "action lane" for layout columns; those stay prose and never become identifiers.

## Consequences

- A standing lane shows work in flight, never a progress bar, health or update reminders.
- A goal lane later adds an end and a ticket source to the same record; nothing about rules, triggers or the view changes.
- Decisions are mirrored to Linear only when its MCP server is connected (ADR 0010). In this round it was not.
