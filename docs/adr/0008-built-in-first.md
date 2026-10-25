# 0008. Build lanes into core behind one module and a developer setting, not as a plugin

Status: accepted, 2026-10-25. Answers question 17. Comparison rows: Assistants D4, D9; Cursor D4.

## Context

A lane needs four things Nyte's plugin API does not give a plugin today:

| Capability | Today | What opening it to plugins takes | Rough cost |
|---|---|---|---|
| Running at host level, outside a session (the watch must poll with no chat open) | Plugins activate per session (`packages/core/src/extend/activation.ts:13-38`); the MCP builtin shows the event-loop pattern but inside a session | A host side with its own lifecycle, crash isolation and trust rules for who may run code with no chat to attribute it to | 8–12 days; a new side and its hooks become a compatibility promise |
| Scheduling (60 s / 5 min ticks that pause while the Mac sleeps and fire once across processes) | Durable waits only inside a tool call or decide hook (`packages/core/src/contract/tools.ts:48`); presence and head leases exist for sessions only | Persisted timers, sleep awareness from the desktop, and a lease so two host processes never both fire | 5–8 days |
| Own record types (lanes, observations, dispatches with unique keys) | `RecordKind` is a closed union (`packages/core/src/contract/records.ts:303-337`); core plugins get key-value storage with no compare-and-set or uniqueness (`packages/core/src/contract/host.ts:170-187`) | A versioned record registry with CAS, unique keys, migrations and `check:store` coverage for third-party shapes | 10–15 days, and the riskiest: it opens the store's integrity to plugins |
| An app panel (the view) | The desktop mounts a fixed list of client plugins (`packages/app/src/client-plugins.tsx:26`); client plugin storage is in memory | A panel contribution point, layout slot and persistence | 5–8 days |

Opening all four costs about 28 to 43 days plus a security review, and every one becomes public API before a second consumer exists. Building the lane in core costs one module that owns its records, the watch loop and the dispatch log (10–15 days) and the view in the app (8–12 days), with no new extension promise. These are estimates from the size of the neighbouring code, not measurements.

## Decision

Lanes are built into core as one module with one public SDK namespace (rows of the view, lanes, drag, answers to questions) and one app panel, behind a developer setting that is off by default. The trigger contract inside it takes no coding types in its interface (ADR 0009), so it can become the plugin API's host-level trigger when a second consumer asks for one.

## Consequences

- The store's new shapes go through the same `check:store` and migration path as every other record.
- Plugins can still contribute skills and prompt sections a lane's rules name; they cannot yet add triggers.
- When an assistant or a workflow needs host-level triggers, extracting the contract means moving one module behind an API, not redesigning four.
