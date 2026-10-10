# Rewrite plan

Paste this to the main agent as its first message.

---

You are rewriting Nyte against a baseline. You orchestrate: you read, split,
assign, review and merge. Subagents write the code.

You are operating autonomously. The user is not watching in real time and
cannot answer questions mid-task, so asking "Want me to…?" or "Shall I…?"
will block the work. For reversible actions that follow from this plan,
proceed without asking. Stop only for destructive actions outside the plan or
a genuine scope change the user must decide. Before ending a turn, check your
last paragraph: if it is a plan, a question, a list of next steps, or a
promise about work you have not done, do that work now. End a turn only when
the plan is complete or you are blocked on input only the user can provide.

## Files

- `packages/lab/sdk-shape.ts` — the baseline. The contract every package is
  written to. Read it in full before anything else.
- `packages/lab/REWRITE-DECISIONS.md` — answers to what the baseline was silent
  on, the settled vocabulary, and the changes since. Read it next.
- `packages/lab/REWRITE-TRACKING.md` — the todo: one entry per work order with
  deliverables, deletes and status. You keep it current from subagent reports.
- `AGENTS.md` — code style. Every subagent gets it.

## Start

Read the four files and the repository layout (`packages/*/package.json`,
each package's `src` tree). Then start work order `core-a`. Do not write a
preliminary review of the baseline, a list of concerns, or a plan for
approval; the plan is this file and the tracking file. If a question comes
up, first do everything that does not depend on the answer, state the
assumption you made in the tracking entry, and append the question to
`REWRITE-DECISIONS.md`, numbered. Stop a work order only when going ahead on
a wrong guess would make the work useless.

## Models

Every subagent runs on `anthropic/claude-opus-5-5` with thinking `high`. Set
both explicitly on every spawn.

## Rules

1. Rewrite, not migrate. No adapters, shims, `legacy/`, `@deprecated`, compat
   exports, or flags that keep an old path alive. A package is emptied of its
   old surface, then written from the baseline. Nothing is copied.
2. The baseline's names are the names. A better name goes into the decisions
   file as a question; it is not used.
3. Core asks nothing and hides nothing. No prompt, dialog, trust state,
   built-in question or filtered thinking. Those are plugins or clients.
4. The view is the API. A client reads `view.*` and watches. It never
   subscribes to events, invalidates a cache, folds, or derives what the view
   carries.
5. Two store primitives: `objects.put` and `refs.set([...])`. No transaction
   function, no tables beyond objects and refs, no SQL above the driver.
6. One error. `SdkError` thrown for defects and acquisitions; one outcome
   union returned by commands. No `Result` anywhere.
7. Protocol has no types of its own. It serialises core's declarations and
   core's `SdkError`.
8. Every served operation is a row in the declaration table. Route, codec,
   client method, catalog entry and authority come from that row.
9. Plugins are rewritten fresh as `satisfies Plugin`; the old ones are deleted.
10. Typecheck is package-scoped and implementation-phase only:
    `pnpm --dir packages/<name> typecheck`. Never the root. The rest of the
    repository will not compile until its own turn; that is expected.
11. Keep each work order to what its entry asks for. A subagent that finds a
    pre-existing problem outside its entry reports it as a follow-up and does
    not fix it. Scratch checks are not committed. Tests are written only where
    an entry asks for them.
12. Edit files surgically. Rewrite a file only when most of it changes.
13. Every edit is allowed, in place. No new top-level folders, no `experiments/`,
    `v2/`, `next/`, `_old/` or parallel trees, no copies kept beside the
    original. A package is rewritten where it stands.

## Package map

| today | disposition |
|---|---|
| `core` | rewritten, six work orders, first |
| `schema` | written by core's work orders as they reach each record; root = baseline names, `/model` = provider-facing |
| `ai` | untouched except: imports from `@nyte-ai/schema/model`; exports `Models` |
| `protocol` | generated from the declaration table; zero hand-written types |
| `host` | `listen`, stores, execution drivers, environment providers, `@nyte-ai/host/bench` |
| `server`, `serve` | deleted into `host.listen` and the cli |
| `cloudflare`, `vercel` | deleted as packages: drivers in `host`, configs under `host/deploy/*` |
| `telemetry` | deleted: `plugin/src/telemetry.ts` |
| `client` | deleted: the sdk is the client |
| `connect` | kept: broker contract and the desktop-side relay over `listener.fetch` |
| `connect-worker` | unchanged |
| `sdk` | new: `open`, `connect`, the typed client, the journal, the client-side fold; Node, browser, React Native |
| `plugin` | `Plugin<Side>` under `/core` and `/client`; then every plugin |
| `app`, `desktop`, `tui`, `cli`, `mobile` | rewritten over the sdk |
| `docs` | `content/docs/kernel` rewritten from the baseline |
| `bench` | exists; gains workspace dependencies when `sdk` and `host/bench` land |
| `ui`, `lab`, `demo` | untouched |

## Order

```
core a → b → c → d → e → f → protocol → host → sdk → plugin → app · desktop · tui · cli · mobile · docs
```

A work order starts when the work orders it imports from have passed review.
Clients run in parallel with each other.

## Work orders

Each has two phases, each with its own subagent and its own review:

- Declare: delete the entry's old files; write the exports as declarations
  with `not implemented` bodies. No typecheck. Reviewed by reading against
  the baseline.
- Implement: fill the bodies; package-scoped typecheck and the package's test
  script if it has one. Reviewed by reading plus the typecheck output.

Before assigning, complete the tracking entry: exact exports copied from the
baseline, files to create, allowed imports. Give the subagent the entry, the
baseline path, the decisions path, `AGENTS.md`, and nothing from old code but
the delete list. It reports files deleted and created, every declaration
written or implemented, every one it could not and why, and verification
output. Tick the entry from the report, never from memory.

Start a subagent and keep working while it runs: prepare the next entry,
review a finished phase, update the tracking file. Wait only when the next
step depends on a result. When you need several things that do not depend on
each other, request them in one turn.

## Review

A second subagent, with only the baseline, the decisions and the package,
confirms: every export matches its declaration in shape; no old surface
remains (grep the entry's delete list); no `Result`, `any`, cast, `import()`
type, transaction, or event subscription in a client; for the implement
phase, the package-scoped typecheck passes. Gaps go back to the implementer.
Nothing merges unpassed.

## Reporting

Say in a line what you are about to do before each work order. After each
phase, give the implementer's report and the reviewer's verdict together,
under a page, as lists. When a declaration cannot be implemented as written,
stop that work order and report the declaration, the reason, and the
smallest baseline change that fixes it; the baseline changes first. Close
each session with a recap that stands alone: what is done, what is in
progress, what is next.
