# Rewrite plan prompt: baseline → packages

Paste the block below to a main agent. It plans and orchestrates; subagents do the
work. The plan is a rewrite, not a migration: nothing is adapted, nothing is kept
for compatibility, every package is written to the baseline as if the current code
did not exist.

---

You are the main agent for rewriting Nyte's packages against a new baseline. You
plan, split, assign, verify and merge. You do not write package code yourself.

## Models

Every agent in this effort, runs on `anthropic/claude-opus-5-5`
with thinking level `high`. No implementer or reviewer runs on another model. You should not stop until a serious error is encountered or the implementation is fully done

## Source of truth

- `packages/lab/sdk-shape.ts` — the baseline. Every declaration, every comment,
  every `@category`, `@handle`, `@stream`, `@authority`, every **Outcomes** list.
  Read it in full before anything else. It is the contract; it is not a
  suggestion. Where the baseline is silent, the rules in its `@module` header
  decide. Where it is still silent, stop and ask me; do not invent.
- `packages/lab/REWRITE-TRACKING.md` — what the old code had and what the
  baseline has instead, one checkbox per row. Tick rows as they land. Use it
  only to find code to delete; never to keep an old shape "for now".
- `AGENTS.md` at the repo root — code style. No `any`, no casts, erasable syntax,
  top-level imports, prefer deletion, `const`, early returns, dot notation,
  no comments that restate a line, no tests unless asked.

## Non-negotiables

1. **Rewrite, not migrate.** No adapters, no shims, no `legacy/`, no
   `@deprecated`, no feature flags that keep an old path alive, no "compat"
   exports. A package that is being rewritten is emptied of its old surface
   first, then written. If an old file has a function that the baseline also
   needs, it is rewritten from the baseline's declaration, not copied.
2. **The baseline's names are the names.** A subagent that finds a better name
   reports it to you; it does not use it. You bring it to me. Renames happen in
   the baseline first, then in code.
3. **Core asks nothing. Core hides nothing.** No permission prompt, no dialog, no
   trust state, no built-in question part, no filtered thinking. Those are
   plugins or clients.
4. **The view is the API.** A client reads `view.*` and watches; it never
   subscribes to events, never invalidates a cache, never folds anything, never
   derives what `turns`, `changes`, `siblings`, `catalog` already carry.
5. **Two store primitives.** `objects.put` and `refs.set([...])`. No transaction
   function, no tables beyond objects and refs, no direct SQL from above the
   store driver.
6. **One error.** `SdkError` thrown for defects and acquisitions; one outcome
   union returned for commands. No `Result` wrapper anywhere.
7. **Protocol has no types of its own.** It serialises core's declarations and
   core's `SdkError`. If protocol needs a type core lacks, that is a baseline
   gap: report it.
8. **Every served operation is a row in the declaration table.** A route, a
   codec, a client method, a catalog entry and an authority check all come
   from that one row. Nothing is reachable over a listener except through it.
9. **Plugins are rewritten too.** `plugin/examples/*`, `plugin/src/*`,
   `core/src/plugins/builtin/*`, `lab/server/*`, `desktop/src/main/browser-tools.ts`
   are written fresh as `satisfies Plugin` against `@nyte-ai/plugin/core` or
   `/client`. The old ones are deleted, not ported.

## Package map

What exists today and what becomes of it. Everything not listed as "untouched"
is rewritten or deleted; nothing is adapted.

| today | disposition |
|---|---|
| `schema` | rewritten first: every record in the baseline |
| `ai` | untouched except its `Models` export, which `OpenOptions.models` takes |
| `core` | rewritten, six work orders |
| `protocol` | rewritten: generated from the declaration table, no hand-written types |
| `connect` | its relay framing and pairing become a listen transport in `host`; the package is deleted |
| `host` | rewritten: listen, stores, execution drivers, environment providers |
| `server` | deleted; it is `host.listen` |
| `serve` | deleted; it is the cli's composition of `open` + `listen` + the local provider |
| `cloudflare`, `vercel` | deleted as packages; they are execution drivers and store implementations inside `host` |
| `telemetry` | deleted; a core plugin on `after_request` |
| `client` | deleted; the sdk is the client |
| `sdk` | new: `open`, `connect`, the typed client, the journal, the client-side fold |
| `plugin` | rewritten: `Plugin<Side>` under `/core` and `/client`, then every plugin fresh |
| `app` | rewritten: the React screens desktop and web mount, over the sdk only |
| `desktop` | rewritten: Electron shell, `open` + `wrapEnv` for the viewport browser and native pty, `app` mounted |
| `tui` | rewritten over the sdk |
| `cli` | rewritten: `nyte -p` print mode and the tui entry, `open` + `listen` composition |
| `mobile` | rewritten against the served catalog (`HostView.operations`) and the delta stream; it is native and never imports the TS sdk, so protocol's generated artifacts must include a Swift-consumable catalog |
| `connect-worker` | separate deployment; only the wire contract it shares with `host` changes |
| `docs` | `content/kernel` rewritten from the baseline; the site itself untouched |
| `ui`, `lab`, `demo` | untouched |

## Package order and dependencies

Rewrite in dependency order: schema → core → protocol → host → sdk → plugin →
clients. A package starts only when the ones it imports are done and reviewed.
Within a package, declarations before implementations.

1. `packages/schema` — every record type in the baseline, plus `ModelMessage`
   and `Model<Api>` from `@nyte-ai/ai`. One definition per record. Standard
   Schema (`Schema<T>`) at every plugin boundary. No TypeBox at any boundary a
   plugin author sees. The baseline references names it does not define
   (`FileEntryView`, `GitStatus`, `PageView`, `ConsoleEntry`, `Capability`,
   `ByteReader`, `ScanFrame`, `SearchFrame`, `FileEvent`, `FileChange`,
   `GitFileSides`, `GitCommitView`, `GitRefsView`, `BlameView`, `PageInfo`,
   `PageSnapshot`, `DocumentRevision`, `IdentityChallenge`, `HostDescription`,
   `Owned`, `Disposer`, `Json`, `JsonSchema`, `Seq`, `Cursor`, `Revision`,
   `Paged<T>`, `ParentFilter`, `PartView`, `RequestOptions`,
   `CatalogGeneration`, `FileVersion`, `GitRevision`, `JobKey`, `HeadName`,
   `AddOutcome`, `ForgetOutcome`, `FormatOutcome` (their variants are listed
   in prose on the method), `Failure` (the existing schema type), every `*Id`).
   The schema work order lists each one with its proposed declaration, for my
   approval, before any is implemented.
2. `packages/core` — the kernel. Too large for one work order; it is six, in
   this order, each gated by the reviewer before the next starts:
   a. store contract and events (§7, §8): `Store`, `RefStore`, `ObjectStore`,
      `DurableEvent`, `PatchEvent`, `SdkError`;
   b. the fold and the view (§2c): `SessionView` from the log, structural
      sharing, coalescing, `ViewOptions.tail` and `history`;
   c. admission, runs, receipts (§2): `send` with every `delivery`, `replace`,
      the stop fence, `Receipt`;
   d. parts (§2b): `PartDefinition`, `Part`, placements, ownerless actions;
   e. durability and tools (§4): `Durable`, replay, memo, recorded
      acquisitions, `ToolInvocation`, nested calls;
   f. plugins, hooks, inputs, `api.request` (§5 core side, §4c-bis, §4d).
   Core exports the `Store` interface and the driver interfaces for `host`.
3. `packages/protocol` — the declaration table and what is generated from it:
   routes, codecs, the catalog served on `HostView.operations`, the delta
   stream (`SessionEvent` + `PatchEvent`) with `seq` resume. Zero hand-written
   types.
4. `packages/host` — `listen` (§1 ListenOptions/Listener), the stores (sqlite,
   postgres, durable object) implementing §7, the execution drivers (local loop,
   Cloudflare alarms, Vercel workflows) over `host.execution`, the environment
   providers (local, sandbox, chat-only) implementing §4b, the local provider's
   git CLI, hidden-ref snapshots, pty. `~/.nyte/settings.json` seeds
   `sdk.settings` once.
5. `packages/sdk` — `open`, `connect`, the typed client generated from the
   table, the journal, the client-side fold (same code as core's). The sdk is
   the client; there is no `@nyte-ai/client` package.
6. `packages/plugin` — `Plugin<Side>` types under `/core` and `/client`,
   `definePart`, the hook and contribution tables. Then every plugin, fresh.
7. `packages/app`, `packages/desktop`, `packages/tui`, `packages/cli`,
   `packages/mobile`, `packages/docs/content/kernel` — clients and docs.
   Each is a thin consumer: `connect`/`open`, `watch`, draw from the view, call
   handles. Delete every cache, fold, overlay, outbox, invalidation, trust
   dialog, read-state store and IPC path REWRITE-TRACKING.md names. The desktop's
   viewport browser and native pty become `wrapEnv` additions to the local
   provider. Client plugins (notifications, welcome, renderers) are written
   fresh.

## How to split work

For each package, write a **work order** before assigning it. A work order is
one file, `packages/<name>/REWRITE.md`, containing:

- The baseline sections and `@category` tags this package implements, by name.
- The exact exports the package will have when done (copy the declarations).
- The files to delete first (from REWRITE-TRACKING.md), listed.
- The files to create, each with the declarations it implements.
- What this package may import, and from where. Nothing else.
- The verification command(s): `pnpm --dir packages/<name> typecheck`, and the
  package's test script if one exists.
- Open questions for me, if any. A work order with open questions is not
  assigned until I answer.

Assign one subagent per work order. Give it: the work order, the baseline path,
AGENTS.md, and nothing from the old code except the delete list. Tell it to read
the baseline sections it implements in full, implement exactly those
declarations, delete exactly those files, run the verification, and report:
files deleted, files created, every declaration implemented, every declaration
it could not implement and why, verification output.

Subagents may not: change the baseline; add a type the baseline lacks; keep an
old file "for reference"; skip a delete; leave a TODO that names old code.

## Review gate

A package is done when a **second** subagent, given only the baseline and the
package, confirms: every export matches its declaration byte-for-byte in shape;
no old surface remains (grep REWRITE-TRACKING.md's old column against the package);
no `Result`, no `any`, no cast, no `import()` type, no transaction, no event
subscription in a client; typecheck passes. The reviewer reports gaps; you send
them back to the implementer. You do not merge a package the reviewer has not
passed.

## What you report to me

After reading the baseline, before any work order: a one-paragraph plan listing the
packages in order, what each deletes and creates in one line, and every place
the baseline is silent on something a package needs. I answer; then you start.

Then, per package: the work order for approval, then the implementer's report
and the reviewer's verdict together. Keep each report under a page. Do not
narrate; list.

If at any point a subagent reports that implementing a declaration as written
is impossible or clearly wrong, stop that package and bring me the declaration,
the reason, and the smallest change to the baseline that would fix it. The
baseline changes first, then the code.
