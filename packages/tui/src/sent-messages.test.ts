import { afterEach, describe, expect, test } from "bun:test";
import { SessionObserver } from "@nyte-ai/client";
import type { SessionObserverClient, SessionState } from "@nyte-ai/client";
import { MAIN, sessionId } from "@nyte-ai/core";
import type { PendingItem, SendReceipt, SessionEvent, SessionSnapshot, Turn } from "@nyte-ai/core";
import { Outbox } from "./outbox.ts";
import { SentMessages } from "./sent-messages.ts";

/** Waits for the outbox's, the observer's, and the resync's own continuations. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Flushes until `check` holds; a bounded number of turns, so a wrong order fails instead of hanging. */
async function until(check: () => boolean): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) {
    if (check()) return;
    await flush();
  }
  throw new Error("condition not met");
}

type CommitItem = Extract<SessionEvent, { kind: "commit" }>["item"];
/** An event without its seq; the harness numbers them as the watch would. */
type EventBody = SessionEvent extends infer E
  ? E extends SessionEvent
    ? Omit<E, "seq">
    : never
  : never;

const SESSION = sessionId("sent-test");

function snapshot(
  options: {
    readonly pending?: readonly PendingItem[];
    readonly transcript?: readonly Turn[];
  } = {},
): SessionSnapshot {
  return {
    seq: 1,
    head: MAIN,
    tip:
      options.transcript?.flatMap((turn) => (turn.kind === "turn" ? [turn.id] : [])).at(-1) ?? null,
    session: {
      sessionId: SESSION,
      activation: { kind: "active" },
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      heads: [{ head: MAIN, tip: null }],
      config: {},
    },
    config: {},
    transcript: options.transcript ?? [],
    pending: options.pending ?? [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
  };
}

/** A pending item as core's queue projection returns it: the change, and the key it was sent under. */
const item = (change: string, key: string, content = "same words"): PendingItem => ({
  change,
  lane: "steer",
  at: 1_000,
  content,
  key,
});

/** The commit a landing writes for a change, as the `commit` event carries it. */
function landing(
  oid: string,
  parent: string | null,
  change: string,
  key: string,
  content = "same words",
): CommitItem {
  return {
    oid,
    commit: {
      kind: "commit",
      parent,
      change,
      key,
      run: "run-1",
      body: { kind: "message", message: { role: "user", content, timestamp: 1_000 } },
      at: 1_500,
    },
  };
}

/** The turn a snapshot carries once that commit is the record. */
function landedTurn(oid: string, parent: string | null, key: string, content = "same words"): Turn {
  return {
    kind: "turn",
    id: oid,
    outcome: "completed",
    startedAt: 1_500,
    durationMs: 0,
    parts: [{ kind: "user", commit: oid, parent, content, key }],
  };
}

/** A watch that yields what is pushed, in order, until its signal aborts; a later watch starts with what is left. */
class EventSource {
  private waiting: PromiseWithResolvers<readonly SessionEvent[]> | undefined;
  private queued: SessionEvent[] = [];

  push(event: SessionEvent): void {
    const wake = this.waiting;
    if (wake === undefined) {
      this.queued.push(event);
      return;
    }
    this.waiting = undefined;
    wake.resolve([event]);
  }

  async *watch(signal: AbortSignal | undefined): AsyncIterable<SessionEvent> {
    const live = (): boolean => signal?.aborted !== true;
    while (live()) {
      if (this.queued.length > 0) {
        const batch = this.queued;
        this.queued = [];
        yield* batch;
        continue;
      }
      const next = Promise.withResolvers<readonly SessionEvent[]>();
      this.waiting = next;
      signal?.addEventListener(
        "abort",
        () => {
          // A push after the abort belongs to the next watch.
          if (this.waiting === next) this.waiting = undefined;
          next.resolve([]);
        },
        { once: true },
      );
      yield* await next.promise;
    }
  }
}

const observers: SessionObserver[] = [];
afterEach(() => {
  for (const observer of observers.splice(0)) observer.close();
});

/**
 * Core's own observer over a scripted store, an outbox whose store answers
 * when the test says, and the sent-message bridge between them, wired as the
 * shell wires them: the observer's snapshots and events reach `sent`, and
 * `sent` asks that same observer to resync. Every snapshot read is answered
 * by the test, so the receipt, the watch's frames, and each snapshot arrive
 * in whatever order a test chooses.
 *
 * `SessionObserver.resync` rejects when another rebase supersedes it. The
 * older `SessionFollower.resync` resolved instead, with or without having
 * published; `superseded: "resolves"` wires that contract so the bridge is
 * held to both.
 */
async function harness(options: { readonly superseded?: "rejects" | "resolves" } = {}) {
  const answers: PromiseWithResolvers<SendReceipt>[] = [];
  /** Every snapshot read the observer made: the bootstrap, then restores and resyncs. */
  const reads: PromiseWithResolvers<SessionSnapshot>[] = [];
  const source = new EventSource();
  let changes = 0;
  let paints = 0;
  let published = snapshot();
  const client: SessionObserverClient = {
    sessions: {
      snapshot: () => {
        const read = Promise.withResolvers<SessionSnapshot>();
        reads.push(read);
        return read.promise.then((answer) => {
          published = answer;
          return answer;
        });
      },
      metadata: () => Promise.resolve(published),
    },
    watch: (input) => source.watch(input.signal),
  };
  const observer = new SessionObserver(client, { sessionId: SESSION, head: MAIN, retryMs: 1 });
  observers.push(observer);
  const sent = new SentMessages({
    resync: () =>
      options.superseded === "resolves"
        ? observer.resync().catch(() => undefined)
        : observer.resync(),
    onChange: () => {
      changes += 1;
      frames.push(visible());
    },
  });
  const keys = ["key-1", "key-2", "key-3"];
  const outbox = new Outbox({
    send: () => {
      const answer = Promise.withResolvers<SendReceipt>();
      answers.push(answer);
      return answer.promise;
    },
    sleep: () => Promise.resolve(),
    now: () => 1_000,
    mintKey: () => keys.shift() ?? "key-late",
    onReceipt: (entry, receipt) => sent.receipt(entry, receipt),
    onChange: (entries) => sent.sending(entries),
  });
  const state = (): SessionState => {
    const current = observer.state;
    if (current === undefined) throw new Error("the observer has no state yet");
    return current;
  };
  const rows = () =>
    sent
      .rows(state().pending, outbox.entries)
      .map((row) =>
        row.kind === "sending"
          ? `sending:${row.entry.key}`
          : `pending:${row.item.change}${row.item.key === undefined ? "" : `@${row.item.key}`}`,
      );
  const transcriptKeys = () =>
    state().transcript.items.flatMap((turn) =>
      turn.kind === "turn"
        ? turn.parts.flatMap((part) => (part.kind === "user" ? [part.key] : []))
        : [],
    );
  /** What one paint would show of the user's messages: the record's keys and the rows. */
  const visible = () => [...transcriptKeys().map((key) => `landed:${String(key)}`), ...rows()];
  /** Every state the shell would paint, in order: each publication and each row change. */
  const frames: string[][] = [];
  observer.subscribe((update) => {
    if (update.kind === "snapshot") {
      sent.snapshot(update.state.pending, update.state.transcript.items);
    } else if (update.kind === "event" && sent.event(update.event, update.state.head)) {
      paints += 1;
    }
    frames.push(visible());
  });
  let seq = 1;
  /** The watch yields one frame; resolves once the observer folded it. */
  const fold = async (body: EventBody): Promise<void> => {
    seq += 1;
    const event: SessionEvent = { ...body, seq };
    source.push(event);
    await until(() => state().seq >= seq);
  };
  /** A snapshot the bridge did not ask for, as recovery would take it: read, published, and watched from. */
  const restore = async (next: SessionSnapshot): Promise<void> => {
    const count = reads.length;
    // The bridge may supersede this rebase with its own; that rejection is the observer's contract.
    const rebased = observer.resync().catch(() => undefined);
    reads[count]?.resolve(next);
    await rebased;
    await flush();
  };
  const started = observer.start();
  reads[0]?.resolve(snapshot());
  await started;
  return {
    sent,
    outbox,
    answers,
    reads,
    fold,
    restore,
    rows,
    transcriptKeys,
    frames,
    changes: () => changes,
    paints: () => paints,
    state,
  };
}

describe("sent messages", () => {
  test("a receipt ahead of the watch keeps one row, under one key, until the fold shows it", async () => {
    const { outbox, answers, rows, fold } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    expect(rows()).toEqual(["sending:key-1"]);

    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    expect(rows()).toEqual(["pending:change-1@key-1"]);
  });

  test("the queued frame ahead of the receipt draws once; the late receipt adds nothing", async () => {
    const { outbox, answers, rows, fold, paints } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    expect(paints()).toBe(1);
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
  });

  test("the commit frame ahead of its landed frame moves the message to the record without a pending twin", async () => {
    const { outbox, answers, rows, fold, state, transcriptKeys } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    await fold({ kind: "head_moved", head: MAIN, from: null, to: "commit-1", reason: "land" });
    await fold({
      kind: "commit",
      head: MAIN,
      item: landing("commit-1", null, "change-1", "key-1"),
    });
    expect(transcriptKeys()).toEqual(["key-1"]);
    expect(state().pending).toEqual([]);
    expect(rows()).toEqual([]);
    await fold({ kind: "landed", head: MAIN, change: "change-1" });
    expect(rows()).toEqual([]);
  });

  test("a receipt after the change landed draws nothing", async () => {
    const { outbox, answers, rows, fold } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    // The watch showed the message and its turn before the store's reply came back.
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    await fold({ kind: "head_moved", head: MAIN, from: null, to: "commit-1", reason: "land" });
    await fold({
      kind: "commit",
      head: MAIN,
      item: landing("commit-1", null, "change-1", "key-1"),
    });
    await fold({ kind: "landed", head: MAIN, change: "change-1" });
    expect(rows()).toEqual([]);
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    expect(rows()).toEqual([]);
  });

  test("a receipt after the change was cancelled draws nothing, and the next send starts clean", async () => {
    const { outbox, answers, rows, fold } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    await fold({ kind: "queue_cancelled", change: "change-1" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    expect(rows()).toEqual([]);
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
  });

  test("a duplicate receipt for a retry draws the message the first attempt made durable", async () => {
    const { outbox, answers, rows } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.reject(new Error("connection reset"));
    await flush();
    expect(rows()).toEqual(["sending:key-1"]);
    answers[1]?.resolve({ kind: "duplicate", change: "change-1" });
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
  });

  test("a duplicate receipt for a change that landed during the retries draws nothing", async () => {
    const { outbox, answers, rows, fold } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.reject(new Error("connection reset"));
    await flush();
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    await fold({ kind: "head_moved", head: MAIN, from: null, to: "commit-1", reason: "land" });
    await fold({
      kind: "commit",
      head: MAIN,
      item: landing("commit-1", null, "change-1", "key-1"),
    });
    await fold({ kind: "landed", head: MAIN, change: "change-1" });
    answers[1]?.resolve({ kind: "duplicate", change: "change-1" });
    await flush();
    expect(rows()).toEqual([]);
  });

  test("identical prompts stay apart by change and key, never by content", async () => {
    const { outbox, answers, rows, fold } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    expect(rows()).toEqual(["pending:change-1@key-1", "pending:change-2@key-2"]);
    await fold({ kind: "queued", head: MAIN, item: item("change-2", "key-2") });
    expect(rows()).toEqual(["pending:change-1@key-1", "pending:change-2@key-2"]);
    await fold({ kind: "head_moved", head: MAIN, from: null, to: "commit-1", reason: "land" });
    await fold({
      kind: "commit",
      head: MAIN,
      item: landing("commit-1", null, "change-1", "key-1"),
    });
    expect(rows()).toEqual(["pending:change-2@key-2"]);
  });

  test("a snapshot taken before the submit applied keeps the message until the resync shows it pending", async () => {
    const { outbox, answers, rows, reads, fold, restore, changes } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    await restore(snapshot());
    expect(rows()).toEqual(["sending:key-1"]);
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    // The receipt is durable, the snapshot did not hold it: the observer is asked for a fresh one, and the row stays meanwhile.
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(reads).toHaveLength(3);
    reads[2]?.resolve(snapshot({ pending: [item("change-1", "key-1")] }));
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(changes()).toBe(0);
    await fold({ kind: "queue_cancelled", change: "change-1" });
    expect(rows()).toEqual([]);
  });

  test("a message the store landed behind the watch stays drawn until the resync shows its turn", async () => {
    const { outbox, answers, rows, reads, restore, transcriptKeys, frames, changes } =
      await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    await restore(snapshot());
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(reads).toHaveLength(3);
    const seen = frames.length;
    // The store already landed the change; the watch's commit has not reached the fold, and never will on this cursor.
    reads[2]?.resolve(snapshot({ transcript: [landedTurn("commit-1", null, "key-1")] }));
    await flush();
    expect(transcriptKeys()).toEqual(["key-1"]);
    expect(rows()).toEqual([]);
    expect(changes()).toBe(0);
    // No paint between the receipt and the record was without the message.
    expect(frames.slice(seen)).toEqual([["landed:key-1"]]);
    expect(reads).toHaveLength(3);
  });

  test("a snapshot taken after the message landed shows the record alone, before and after the receipt", async () => {
    const { outbox, answers, rows, reads, restore, transcriptKeys } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    await restore(snapshot({ transcript: [landedTurn("commit-1", null, "key-1")] }));
    expect(transcriptKeys()).toEqual(["key-1"]);
    expect(rows()).toEqual([]);
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    expect(rows()).toEqual([]);
    expect(reads).toHaveLength(2);

    // The same landing, seen after the receipt: the snapshot places the arriving row and it goes.
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
    await restore(
      snapshot({
        transcript: [
          landedTurn("commit-1", null, "key-1"),
          landedTurn("commit-2", "commit-1", "key-2"),
        ],
      }),
    );
    expect(rows()).toEqual([]);
    expect(reads).toHaveLength(3);
  });

  test("a snapshot that holds the message as pending adopts the arriving row", async () => {
    const { outbox, answers, rows, reads, restore } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot({ pending: [item("change-1", "key-1")] }));
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(reads).toHaveLength(2);
  });

  test("a message cancelled before the snapshot leaves once the resync's snapshot was applied without it", async () => {
    const { outbox, answers, rows, reads, restore, changes, frames } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    void outbox.submit({ content: "same words", lane: "steer" });
    // Another client cancelled the first; the second was still on its way when the snapshot was read.
    await restore(snapshot());
    expect(rows()).toEqual(["pending:change-1@key-1", "sending:key-2"]);
    expect(reads).toHaveLength(3);
    const seen = frames.length;
    reads[2]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual(["sending:key-2"]);
    expect(changes()).toBe(1);
    // The snapshot painted first, still with the row; the row left in its own paint after the snapshot was applied.
    expect(frames.slice(seen)).toEqual([
      ["pending:change-1@key-1", "sending:key-2"],
      ["sending:key-2"],
    ]);

    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
    expect(reads).toHaveLength(4);
    reads[3]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual([]);
    expect(changes()).toBe(2);
  });

  test("one resync answers for every receipt the snapshot could not place", async () => {
    const { outbox, answers, rows, reads, restore, changes } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    await restore(snapshot());
    expect(rows()).toEqual(["pending:change-1@key-1", "pending:change-2@key-2"]);
    expect(reads).toHaveLength(3);
    reads[2]?.resolve(snapshot({ pending: [item("change-2", "key-2")] }));
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
    expect(changes()).toBe(1);
    expect(reads).toHaveLength(3);
  });

  test("a resync asked before a receipt cannot erase it: a newer read answers for both", async () => {
    const { outbox, answers, rows, reads, restore, changes, frames } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot());
    expect(reads).toHaveLength(3);
    // The second receipt lands while the first's resync is still reading; its watch was continuous, so it asks nothing.
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1", "pending:change-2@key-2"]);
    expect(reads).toHaveLength(3);
    const seen = frames.length;
    // That read predates the second submit: it holds neither, and may only speak for the first.
    reads[2]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1", "pending:change-2@key-2"]);
    expect(changes()).toBe(0);
    expect(reads).toHaveLength(4);
    reads[3]?.resolve(snapshot({ pending: [item("change-2", "key-2")] }));
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
    expect(changes()).toBe(1);
    for (const frame of frames.slice(seen)) expect(frame).toContain("pending:change-2@key-2");
  });

  test("a receipt a snapshot spanned during an older resync starts a newer one", async () => {
    const { outbox, answers, rows, reads, restore, changes } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot());
    expect(rows()).toEqual(["pending:change-1@key-1", "sending:key-2"]);
    expect(reads).toHaveLength(3);
    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    // The second was spanned too, and the read under way was asked before it: a newer read supersedes it.
    expect(reads).toHaveLength(4);
    reads[2]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1", "pending:change-2@key-2"]);
    expect(changes()).toBe(0);
    reads[3]?.resolve(snapshot({ pending: [item("change-2", "key-2")] }));
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
    expect(changes()).toBe(1);
  });

  test("a resync another rebase superseded keeps the row; that rebase's snapshot asks again", async () => {
    const { outbox, answers, rows, reads, restore, changes } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot());
    expect(reads).toHaveLength(3);
    // Recovery rebased before the resync's read landed; the read answers into a stopped loop.
    await restore(snapshot());
    reads[2]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(changes()).toBe(0);
    expect(reads).toHaveLength(5);
    reads[4]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual([]);
    expect(changes()).toBe(1);
  });

  test("a superseded resync that resolves without its snapshot reaching the bridge says nothing", async () => {
    const { outbox, answers, rows, reads, restore, changes } = await harness({
      superseded: "resolves",
    });
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot());
    expect(reads).toHaveLength(3);
    const count = reads.length;
    // Recovery rebases and the resync resolves at once, before either read landed: no snapshot vouches for anything yet.
    const rebased = observers[0]?.resync().catch(() => undefined);
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(changes()).toBe(0);
    reads[count]?.resolve(snapshot());
    await rebased;
    await flush();
    expect(reads).toHaveLength(5);
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    reads[4]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual([]);
    expect(changes()).toBe(1);
  });

  test("a resync that resolves after publishing answers only for the receipts it was asked after", async () => {
    const { outbox, answers, rows, reads, restore, changes, frames } = await harness({
      superseded: "resolves",
    });
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot());
    expect(reads).toHaveLength(3);
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[1]?.resolve({ kind: "queued", change: "change-2" });
    await flush();
    const seen = frames.length;
    // The snapshot is published, a newer resync is asked from within it, and the older one resolves anyway.
    reads[2]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
    expect(changes()).toBe(1);
    expect(reads).toHaveLength(4);
    reads[3]?.resolve(snapshot({ pending: [item("change-2", "key-2")] }));
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-2"]);
    expect(changes()).toBe(1);
    for (const frame of frames.slice(seen)) expect(frame).toContain("pending:change-2@key-2");
  });

  test("a failed read keeps the row; the observer's retried read answers", async () => {
    const { outbox, answers, rows, reads, restore, changes } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot());
    expect(reads).toHaveLength(3);
    reads[2]?.reject(new Error("store busy"));
    await until(() => reads.length === 4);
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(changes()).toBe(0);
    reads[3]?.resolve(snapshot());
    await flush();
    expect(rows()).toEqual([]);
    expect(changes()).toBe(1);
  });

  test("a closed observer's rejected resync leaves the row alone", async () => {
    const { sent, outbox, answers, rows, reads, restore, changes } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    await restore(snapshot());
    expect(reads).toHaveLength(3);
    for (const observer of observers) observer.close();
    await flush();
    expect(rows()).toEqual(["pending:change-1@key-1"]);
    expect(changes()).toBe(0);
    expect(sent.rows([], outbox.entries)).toHaveLength(1);
  });

  test("a redelivered message keeps its key: the copy's queued frame answers the original's receipt", async () => {
    const { outbox, answers, rows, fold } = await harness();
    void outbox.submit({ content: "same words", lane: "steer" });
    await fold({ kind: "queued", head: MAIN, item: item("change-1", "key-1") });
    await fold({ kind: "queue_cancelled", change: "change-1" });
    await fold({
      kind: "queued",
      head: MAIN,
      item: { ...item("change-2", "key-1"), lane: "queue" },
    });
    answers[0]?.resolve({ kind: "queued", change: "change-1" });
    await flush();
    expect(rows()).toEqual(["pending:change-2@key-1"]);
  });
});
