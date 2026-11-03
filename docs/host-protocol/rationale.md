# Rationale

## Problem

The host projects a whole `SessionView` per fold state and the protocol diffs consecutive views by object identity to make frames. That ties three things together that should be apart: core keeps eight identity caches so the diff can find reuse, the wire carries positional splices a client can only apply to the exact previous frame, and heads reach clients twice, once in `SessionInfo.heads` and once in `SessionView.heads`. A client that reconnects starts over. A client that wants one row re-projects the view. The directory watch re-lists every session on every directory event.

Constraints found while grounding: the session log's seq already starts at 1 with no gaps and never goes backwards (census, 1,006,079 events over 999 sessions); `refs.revision` is a random UUID and carries no order, so it cannot be a seq; streaming text is never durable (no `patch` rows in the store), so it cannot be seq-stamped; the fold's row-building already happens per id in `draft.ts` (`setMessage` at :102, `setTurn` at :115), so stamping rows there is a field, not a rewrite.

## Measurements

From this machine's store and a copy of it, recorded 2026-11-02. Scripts and raw captures live in `.local/host-protocol/`, which is not committed; the numbers below carry their run counts.

**Store** (`store-census.md`, one pass over a 4.95 GB copy):

- 999 sessions, 1,006,079 events, 1.25 GB of event JSON. Median event 326 B, p95 3.9 KB, max 1.5 MB.
- Events per session: median 638, p95 3,002, max 18,198.
- By count: `commit` 154k, `part created` 151k, `part settled` 151k, `run phase` 142k, `call intent` 90k.
- By bytes: `call settled` 370 MB from 9% of events; `changes` 289 MB from 1% of events at 28 KB mean; `part updated` 241 MB, mostly thinking text.
- `part updated` is written about once per part, not per token. Streaming text is not in the store.
- Checkpoints: 268, 502 MB, none matching this checkout's fold code; the largest sessions have none and replay from the start.

**Traffic** (`traffic.md`, two recordings of 5.0 and 4.0 minutes against a host on the copy, mirrored from the live store; frame counts are a lower bound because the mirror batches commits on a 500 ms poll and carries no streaming text):

- `sessions.watch` (roots): 42.4 to 42.7 KB snapshot, then 8.5 to 14.2 frames/min at about 830 B each. In run 1, 71 of 71 frames were about sessions the client did not have open.
- `head.watch` on the largest session: 99.6 KB at `tail: 40`, 378 KB at the default tail of 200; 188 to 647 ms to the first frame from a checkpoint.
- `head.watch` deltas on active sessions: median 2.8 to 3.8 KB, p95 up to 21 KB; 0.94 to 1.68× the bytes of the events behind them, because a changed message or turn is resent whole and the 27 KB catalog is resent whole when any entry changes.
- Base64 envelopes add 1.33×; deflate would cut frames to 26 to 43%.

**Host CPU** (`host-profile.md`, `node --cpu-prof`, 3 runs per number):

- Cost per event does not grow with session size: 2.3 to 2.9 ms mean at 100, 1,000 and 10,000 prior events with only `head.watch` attached. Fold, projection, diff and encoding are about 0.03 ms of that.
- Commit to frame: median 0.63 to 0.72 ms, limited by `refs.set`.
- The directory watch is the cost. A 300-row `sessions.watch` adds 2.3 to 2.6 ms per event, p95 12.5 to 13.3 ms. Under full load (head + roots + 300 rows, 9,099 events) it re-listed 7,768 times and produced no frame; 46% of main-thread time was typebox checking SQLite worker replies (`packages/host/src/sqlite-workers.ts:120`) for those lists, 7.9% the re-list in `api/session.ts`.
- Fold 1.5%, `project.ts` 0.5%, `view-frames.ts` 0.1%, `sseFrames` 0.1%.

So the premise that whole-view projection and diffing cost the host is false; they cost 30 µs. What the redesign buys on the host is deleting the re-list. What it buys everywhere else is bytes, resume, and a client that patches one row instead of re-diffing a view the host already diffed (`packages/app/src/data/watches.ts:98-115`).

**Durable calls** (`packages/core/test/parallel-tool-calls.test.ts`, failed 4 of 4 runs before the fix, passes after): 24 parallel calls from one fan-out settled one per retry round, so with 8 rounds 16 of 24 failed with `lost to concurrent writes`. The settlement CASes the head tip (`tool-runner.ts:801-811`); `changeCall` serialized per call, not per run. Now it serializes per run too (`commit.ts`).

## Usage

The TUI opens one connection per host and keeps it:

```ts
const host = await connect(address, {
  client: { kind: "tui", name: "nyte", version, actions: [] },
  apiMinRevision: 1,
});

const events = host.events.subscribe([`session/${session}`]);
const window = await host.head(session, "main").read({ tail: 200 });
const store = headStore(window);

for await (const event of events) store.apply(event);
```

After a drop, the same store resumes instead of starting over:

```ts
const window = await host.head(session, "main").read(
  { tail: 200 },
  { resume: { seq: store.seq, from: store.order[0] ?? null } },
);
store.resume(window);
```

The desktop's sidebar reads the sessions table and derives everything about heads from it:

```ts
const events = host.events.subscribe(["host"]);
const sessions = await host.sessions.read({ resume: { seq: directory.seq } });
directory.resume(sessions);
```

An agent asks the app to open a chat, through the app's declared action:

```ts
await host.client.perform({ client: app.id, action: "chat.open", input: { session }, timeoutMs: 5000 });
```

## Shape

Core types, in the order data flows.

```ts
type Seq = number;

interface Stamped<Row> {
  readonly row: Row;
  readonly seq: Seq;
}

interface HeadTables {
  readonly head: Stamped<HeadState>;
  readonly messages: ReadonlyMap<MessageId, Stamped<Message>>;
  readonly turns: ReadonlyMap<TurnId, Stamped<TurnInfo>>;
  readonly background: ReadonlyMap<string, Stamped<BackgroundItem>>;
  readonly path: Path;
}

interface FoldState {
  readonly seq: Seq;
  readonly heads: ReadonlyMap<HeadName, HeadTables>;
  readonly parts: ReadonlyMap<PartId, Stamped<PartView>>;
  readonly changes: ReadonlyMap<string, Stamped<FileChange>>;
  readonly catalog: ReadonlyMap<string, Stamped<CatalogEntry>>;
  readonly touched: Touched;
}

interface Touched {
  readonly tables: ReadonlyMap<Table, { readonly upsert: ReadonlySet<string>; readonly drop: ReadonlySet<string> }>;
  readonly windows: ReadonlySet<HeadName>;
}

type WindowSpec = { readonly tail: number } | { readonly from: MessageId };

interface Resume {
  readonly seq: Seq;
  readonly from: MessageId | null;
}

interface Window {
  readonly seq: Seq;
  readonly order: readonly MessageId[];
  readonly leadingPrompt: MessageId | null;
  readonly turns: readonly TurnId[];
  readonly rows: Changes;
  readonly live: Live;
}

type Changes = { readonly [table: string]: { readonly upsert: readonly unknown[]; readonly drop: readonly string[] } };

function readWindow(state: FoldState, head: HeadName, window: WindowSpec, resume: Resume | null): Window;

function changeEvent(state: FoldState): ChangeEvent;
```

`fold(state, event)` stamps every row it writes with the new seq and records it in `touched`, which it clears at the start of each step. `changeEvent` is then a lookup, not a diff: the rows in `touched` at `state.seq`. `readWindow` with a `resume` sends rows whose `seq > resume.seq` plus rows positioned before `resume.from`; without one it sends the window whole. Both carry `live` whole.

The sessions table is maintained at write time, not by re-listing: the store's session index gains a per-host `seq` column assigned in the same transaction as the ref write, and the host publishes the rows that transaction touched as one host-scope `change`. `sessions.read { resume: { seq } }` is `WHERE seq > ?`. A change to a child's execution restamps its parent's row, so background counts stay derivable from the table.

What the types encode: a row cannot exist without its seq; a `Window` cannot be built without saying which seq it is current through; a resume cannot omit `from`. What stays runtime: whether `from` is still on the path. What the design refuses to do: patch fields, splice by position, or carry a head's `HeadInfo` anywhere but the sessions table.

The interface is two functions and one event shape over a fold the clients never see. It hides the path, the per-principal projection, the window arithmetic and the stamp bookkeeping; a client learns `apply(event)` and `resume(window)`.

## Audit

What is wrong with the code this lands in, with the principle each breaks, and whether it blocks the change.

| Where | What | Principle | Blocks |
| --- | --- | --- | --- |
| `packages/core/src/fold/project.ts:28-46` | Eight `WeakMap` caches (`projections`, `shownHeads`, `shownHead`, `tails`, `queues`, `absent`, `windows`, `usages`, `unsigned`) exist so `view-frames.ts` can diff by identity. Core's memoization is dictated by the wire's diffing strategy. | Information leakage; minimize reader load | Yes: deleted |
| `packages/protocol/src/view-frames.ts:110-143, 252-272` | Diffs whole views by identity, then string-compares every message's markdown prefix to recover streamed text the fold already knew was an append. | Two ways to do one task (PatchEvent and `appendedText`); subtract before you add | Yes: deleted |
| `packages/core/src/api/session.ts:265-354` | Re-lists every session on every directory event, fingerprints each row with `JSON.stringify` (:326); measured 7,768 re-lists for 0 frames and 46% of main-thread CPU. | Explain the number; model the domain (the directory is a table, not a query) | Yes: replaced by write-time stamping |
| `packages/schema/src/views.ts:145` and `sessions.ts:35` | Heads in both `SessionView` and `SessionInfo`; `headsFor` in `project.ts:114` and `describeSession` compute them separately. | Split ownership | Yes: `SessionView.heads` goes |
| `packages/app/src/data/watches.ts:98-115` | `keepShown`/`keepItems` re-diff by key what the host diffed by identity, to keep React references stable. | Two ways to do one task | Yes, in the client step: rows by id make it moot |
| `packages/app/src/data/session-rows.ts:338-343` | Merges `view.heads` over `listed.heads` per session. | Split ownership | Yes, in the client step |
| `packages/host/src/sqlite-workers.ts:120` | `Value.Check` on every worker reply; a worker thread in the same process is not a trust boundary. 46% of main-thread time under directory load. | Boundary discipline | No. Out of scope; the re-list that drives it goes away, which removes most of the calls |
| `packages/core/src/fold/commit.ts:103` | `changeCall` serialized per call while settlements CAS the head tip. | Separate before serializing shared state | Fixed this session |
| `packages/protocol/src/stream-channel.ts` | Base64 envelopes at 1.33× with no compression. | Explain the number | No. Transport work for the host step |

The sketch deletes the first four before adding anything.

## Tradeoffs accepted

- We accept resending a whole row per change in exchange for idempotent, order-independent application and no identity caches. A thinking part's row is the largest common case (median `part updated` is the state of one part); the 1.5 MB `changes` events become per-path rows and shrink.
- We accept an explicit `order` of up to 200 ids per land, about 8 KB, in exchange for not depending on message timestamps being monotonic along a rewound path.
- We accept live facts sent whole on every attach and resume in exchange for never reconciling them.
- We accept a store schema change (a `seq` column on the session index) in exchange for deleting the re-list.
- We accept that a client with an unplaceable `from` gets a whole window, in exchange for a resume rule with no special cases.
- We accept that `changeCall` serializes a run's parallel settlements, including the snapshot diff inside `conclude`, in exchange for no retry storm. If the serialized diffs show up in latency, `conclude` starts in the tool body before settlement.

## Alternatives considered

- **Keep whole views, add a seq per frame.** Hides nothing new: a frame still only applies to the frame before it, so resume stays impossible and the identity caches stay. Lost on resume and on one owner per fact.
- **Rex's shape: per-connection seq, thin "revision changed" events, re-read on reconnect.** Simplest host. Lost on bytes: a reconnecting phone re-reads 99 to 378 KB per open head, and the directory in full. Rex can afford it because a terminal's view is small; a transcript is not.
- **Field-level patches (RFC 6902).** Smallest frames. Lost on idempotence and simplicity: patches are positional, cannot be applied twice, and need the host to keep the previous view, which is the identity-cache design again.
- **Ship the log, fold on the client.** One code path. Lost on cost: an 18k-event session is 49 MB, every client would carry core and its fold-code hash, and mobile cannot.

## Decisions on the open questions

1. Window order is explicit. The host sends `order`; messages are not sorted by `(at, id)`, because nothing proves `at` is monotonic along a rewound path.
2. The host-scope seq is a column on the session index in all three stores, assigned in the writing transaction (store version 27). A 5 GB copy of a real store migrated in 0.46 s.
3. Background counts stay host-computed in the head row; a child's run restamps its parent's row.
4. The local socket is a unix socket in the host's state directory, mode 0600. Loopback TCP is not local, because Tailscale Serve forwards network traffic to it.
5. Both channels ride one WebSocket. pi uses WebSocket only; opencode uses SSE for its one-way event stream because browsers cannot set headers on an upgrade, and gives its sockets a one-time ticket. Nyte does the same for browsers and needs no SSE on the new channel.
6. Terminals stay on `@lydell/node-pty`, and the desktop's launchd host runs on the app's own Node (`ELECTRON_RUN_AS_NODE`), as the embedded host did. The Bun-compiled `nyte` cannot load node-pty: the require path lands in `/$bunfs`, and Bun 1.4.4 breaks node-pty's JavaScript (oven-sh/bun#25822). Bun's built-in PTY worked but meant two backends and no backpressure, so it was reverted. opencode ships the same two-backend split (`bun-pty` under Bun, `@lydell/node-pty` under Node, chosen by package `imports` conditions) and is moving terminals into a daemon (`opencode-pty`: portable-pty and libghostty-vt, one owner, a ticket handoff so terminals survive a server restart). A terminal daemon in our Go sidecar is the shape to reach for when terminals must outlive a host restart.
7. Nyte runs one host per user per machine, and every client attaches to it, the TUI included. No server sits in front of the host. Rex has none either: one Go process under launchd holds the PTYs, the session snapshots, the tsnet node and the unix socket, and the Mac app and the `rex` CLI are clients on that socket. A Go forwarder in front of the host added 20 µs per small read (52 to 72 µs p50), 52 to 91 µs per connect and 0.9 ms of its own CPU per MB forwarded, and removes no round trip. What it would protect, processes that outlive a host restart, matters little while the host restarts only after a crash or when the owner accepts the restart dialog; quitting or updating the app leaves it running. The TUI ran its own host on the shared store, so quitting it killed its agent's jobs and interrupted the tool call in flight, and other clients could not see its jobs. It is now a client of the machine's host, which launchd starts when the app is installed and the first `nyte` starts (`nyte host --log`, detached) when it is not; that host outlives the `nyte` that started it.
8. Open: the fold-code hash still covers every file in `fold/`, so a change with no fold semantics, such as `commit.ts`, invalidates every checkpoint.

## Measured since

- End to end, on a copy of a real store (5.25 GB, 1,021 sessions, 1,086,751 events), one client attaching, opening the 3 largest sessions, running a turn with text and 3 tools, dropping and resuming, and switching 20 sessions; 3 interleaved runs per side against 2bdd9710f, cold page cache, medians. Over a 50 ms, 20 Mbit/s link: total 6,516 ms against 7,378, 2.36 MB down against 4.41, attach 150 ms against 211, resume 139 ms against 416, switch 3,412 ms against 3,897, host CPU 2,634 ms against 2,609. On loopback: total 4,198 ms against 4,265, 10.06 MB against 14.98, resume 33 ms against 96, host CPU 2,526 ms against 2,370. Three fixes got it there: the client pipelines the subscribe and the read, a bus event sends only its own rows, and the socket deflates for peers off the machine. Opening a cold session is still bound by reading the log from disk (131 MB for the 3 sessions) and costs 10% more host CPU, most of it the synchronous checkpoint write.
- The directory watch without the re-list: 1.21 to 1.42 ms CPU per event against 3.36 to 3.81 before, and 0 full lists against 1,000, on 300 sessions with a 300-row watch (3 runs).
- Change bytes against today's `head.watch` frames, medians per kind: land 35 vs 484, part created 528 vs 888, call settled 1,188 vs 1,379, run phase 391 vs 728; totals smaller on every recorded log (6.04 MB vs 7.84 MB on the 10,643-event one). `part updated` (417 vs 85) and `input` (515 vs 420) are gated on totals only, with the reason printed: whole rows cannot match today's text-append frames without field patches.
- One turn in the largest real session (text and 3 tool calls, end to end, 3 runs): change events 289.8 KB to 81.5 KB and the turn's bytes down 307.5 KB to 99.2 KB, against 103.7 KB for `head.watch`, once a bus event's change carries only the rows it touched instead of the whole step at its seq. Before, 110 of 203 catalog rows and 324 of 360 background rows were rows the client already held.
- Embedded Tailscale: the sidecar is 19.3 MiB, 33.5 to 34.3 MiB resident, 326 to 359 ms to running; libtailscale through `node:ffi` saved about 3 MiB, no time, blocked its thread and ignored SIGTERM (3 runs each).

## Next implementation step

Delete the old path once the desktop app reads rows: the SDK's watch APIs, `head.watch`, `sessions.watch` and `part.watch`, `view-frames.ts`, core's in-process watches, `project`'s caches (with `head.view` rebuilt on `readWindow`), and `SessionView.heads`.
