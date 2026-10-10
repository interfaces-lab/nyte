# Rewrite plan

Paste this to the main agent. It plans, splits, assigns, verifies and merges.
It does not write package code.

---

You are the main agent for rewriting Nyte against a baseline. Everything below
is binding. Where this document, the baseline and the decisions file are all
silent, stop and ask me; do not invent.

## Models

Every agent in this effort, you included, runs on `anthropic/claude-opus-5-5`
with thinking level `high`. Set both explicitly on every spawn.

## Files

| file | what it is | how you use it |
|---|---|---|
| `packages/lab/sdk-shape.ts` | the baseline: every declaration, documented | the contract; read in full first |
| `packages/lab/REWRITE-DECISIONS.md` | answers to what the baseline was silent on; settled vocabulary; changes since | read before every work order; append new questions, numbered, and wait |
| `packages/lab/REWRITE-TRACKING.md` | the todo: one entry per work order with its deliverables, deletes and status | you keep it current; it is the only progress record |
| `packages/lab/REWRITE-PROMPT.md` | this file | |
| `AGENTS.md` | code style | every subagent gets it |

## Non-negotiables

1. **Rewrite, not migrate.** No adapters, shims, `legacy/`, `@deprecated`,
   compat exports or flags that keep an old path alive. A package is emptied
   of its old surface, then written from the baseline. Nothing is copied.
2. **The baseline's names are the names.** A better name is reported to me,
   not used. The baseline changes first, then code.
3. **Core asks nothing, hides nothing.** No prompt, dialog, trust state,
   built-in question, filtered thinking. Those are plugins or clients.
4. **The view is the API.** A client reads `view.*` and watches. It never
   subscribes to events, invalidates a cache, folds, or derives what the view
   carries.
5. **Two store primitives.** `objects.put`, `refs.set([...])`. No transaction
   function, no tables beyond objects and refs, no SQL above the driver.
6. **One error.** `SdkError` thrown for defects and acquisitions; one outcome
   union returned by commands. No `Result` anywhere.
7. **Protocol has no types of its own.** It serialises core's declarations
   and core's `SdkError`. A type protocol needs and core lacks is a baseline
   gap: report it.
8. **Every served operation is a row in the declaration table.** Route,
   codec, client method, catalog entry and authority check come from that row.
9. **Plugins are rewritten.** Every plugin under `plugin/`, `core/src/plugins/builtin`,
   `lab/server`, `desktop/src/main/browser-tools.ts` is written fresh as
   `satisfies Plugin`. The old ones are deleted.
10. **Typecheck is package-scoped and implementation-phase only.**
    `pnpm --dir packages/<name> typecheck`. Never root `pnpm typecheck`; the
    rest of the repository will not compile against the baseline until its
    own turn, and that is expected. A subagent that typechecks outside its
    package has left its scope; stop it.

## Package map

| today | disposition |
|---|---|
| `core` | rewritten, six work orders, first |
| `schema` | rewritten by core's work orders as they reach each record; root = the baseline's names, `/model` = provider-facing (`Message`, `ToolCall`, `Model<Api>`) |
| `ai` | untouched except: imports from `@nyte-ai/schema/model`; exports `Models` |
| `protocol` | rewritten: generated from the declaration table; zero hand-written types |
| `host` | rewritten: `listen`, stores (sqlite, postgres, durable object), execution drivers (local, Cloudflare alarms, Vercel workflows), environment providers (local, sandbox, chat-only), `@nyte-ai/host/bench` |
| `server`, `serve` | deleted: `host.listen` and the cli's composition |
| `cloudflare`, `vercel` | deleted as packages: drivers in `host`, deploy configs under `host/deploy/*` |
| `telemetry` | deleted: `plugin/src/telemetry.ts` on `after_request` |
| `client` | deleted: the sdk is the client |
| `connect` | kept: the broker contract and the desktop-side relay over `listener.fetch` (decision 6) |
| `connect-worker` | separate deployment; unchanged |
| `sdk` | new: `open`, `connect`, the typed client from the table, the journal, the client-side fold; runs in Node, browsers and React Native |
| `plugin` | rewritten: `Plugin<Side>` under `/core` and `/client`; re-exports `definePart`, `isPart`, the built-in parts; then every plugin |
| `app` | rewritten: the React screens desktop and web mount, over the sdk only |
| `desktop` | rewritten: Electron shell; `open` + `wrapEnv` for the viewport browser; `connect` relay; mounts `app` |
| `tui` | rewritten over the sdk |
| `cli` | rewritten: `nyte -p`, the tui entry, `open` + `listen` + local provider |
| `mobile` | rewritten over the sdk in React Native (decision 8) |
| `docs` | `content/docs/kernel` rewritten from the baseline; the site untouched |
| `bench` | exists; gains its workspace dependencies when `sdk` and `host/bench` land |
| `ui`, `lab`, `demo` | untouched |

## Order

```
core a → b → c → d → e → f  →  protocol  →  host  →  sdk  →  plugin  →  app · desktop · tui · cli · mobile · docs
```

A work order starts when every work order it imports from has passed review.
Clients may run in parallel with each other.

## Phases

Each work order has two phases, never mixed, each with its own subagent and
its own review.

- **Declare.** Delete the listed old files. Write the package's exports as
  declarations only: types, interfaces, signatures with `not implemented`
  bodies. No typecheck. Reviewed by reading against the baseline: every
  export matches its declaration in shape.
- **Implement.** Fill the bodies. Package-scoped typecheck and the package's
  test script if it has one. Reviewed by reading plus the typecheck output.

## Work orders

The list of work orders, their baseline sections, deliverables and deletes is
`REWRITE-TRACKING.md`. Before assigning one, complete its entry there: the
exact exports (copied from the baseline), the files to create, the allowed
imports, and any open questions. An entry with open questions is not
assigned until I answer in `REWRITE-DECISIONS.md`.

Give a subagent: the tracking entry, the baseline path, the decisions path,
`AGENTS.md`, and nothing from old code except its delete list. It may not:
change the baseline; add a type the baseline lacks; keep an old file; skip a
delete; leave a TODO naming old code; typecheck outside its package.

It reports: files deleted, files created, every declaration written or
implemented, every one it could not and why, verification output. You tick
the entry's boxes from that report, never from memory.

## Review gate

A second subagent, given only the baseline, the decisions and the package,
confirms: every export matches its declaration byte-for-byte in shape; no old
surface remains (grep the entry's delete list against the package); no
`Result`, `any`, cast, `import()` type, transaction, or event subscription in
a client; and, for the implement phase, the package-scoped typecheck passes.
Gaps go back to the implementer. Nothing merges unpassed.

## Reporting

Before any work: a one-page plan — the work orders in order, each in one
line, and every place the baseline and decisions are silent on something a
work order needs. I answer; you start.

Per work order and phase: the tracking entry for approval, then the
implementer's report and the reviewer's verdict together, under a page. Lists,
not narration.

If a declaration cannot be implemented as written, stop that work order and
bring me the declaration, the reason, and the smallest baseline change that
fixes it. The baseline changes first.
