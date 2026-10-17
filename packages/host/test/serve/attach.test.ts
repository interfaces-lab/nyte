import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { CommitId, DurableEvent, HeadName, Json, SessionId } from "@nyte-ai/schema";
import { envelope, headRef } from "@nyte-ai/core/store";
import type { CommitRecord } from "@nyte-ai/core/store";
import type { Store } from "@nyte-ai/core";
import { decodeOutput, parseSse } from "@nyte-ai/protocol";
import { afterAll, assert, expect, it } from "vitest";
import { sqliteStore } from "../../src/index.ts";
import { post, served } from "./fakes.ts";

const main: HeadName = asId("main");

/** A first frame of the default tail, 200 short messages and their turns, whatever the session's length. */
const FRAME_BUDGET = 256 * 1024;

/** How much longer attaching to a 10,000-message chat may take than to a 100-message one: restoring its checkpoint takes about 50 ms here, and replaying its 40,000 events without one about 270 ms. */
const ATTACH_SPREAD_MS = 100;

const folders: string[] = [];

afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** Starts a chat and grows it to `messages` messages: each exchange after the first a question and an answer streamed in four updates, as a model's text part is logged. */
async function chat(store: Store, messages: number): Promise<SessionId> {
  const { handler, fake, host } = await served({ store });
  fake.reply("Hi.");

  const started = decodeOutput(
    "sessions.start",
    await (
      await post(handler, "sessions.start", { id: crypto.randomUUID(), content: "Hi." })
    ).json(),
  );

  const session = asId<"session">(started.session);
  await post(handler, "receipt.settled", { session, receipt: started.receipt });

  const commit = async (parent: CommitId, body: CommitRecord["body"]) =>
    asId<"commit">(
      await host.kernel.store.objects.put(
        envelope("commit", { parent, at: 0, run: null, body } satisfies CommitRecord, 0),
      ),
    );

  for (let from = 1; from < messages / 2; from += 250) {
    const ref = await host.kernel.store.refs.get(headRef(session, main));
    assert(ref?.target !== null && ref?.target !== undefined);
    let tip: CommitId = asId(ref.target);
    const events: DurableEvent[] = [];

    for (let exchange = from; exchange < Math.min(messages / 2, from + 250); exchange += 1) {
      const question: CommitRecord["body"] = {
        kind: "user",
        message: asId(`question-${exchange}`),
        content: `Question ${exchange}: ${"a sentence of about this length. ".repeat(3)}`,
        source: { kind: "user" },
        delivery: "steer",
        siblings: [],
      };

      const asked = await commit(tip, question);
      const part = asId<"part">(`answer-${exchange}`);
      const answer: CommitRecord["body"] = { kind: "part", part };
      const answered = await commit(asked, answer);
      const markdown = (words: number) => `Answer ${exchange}: ${"word ".repeat(words)}`;

      events.push(
        { head: main, kind: "commit", id: asked, parent: tip, run: null, body: question },
        {
          head: main,
          kind: "part",
          part,
          change: "created",
          partKind: "text",
          placement: { kind: "transcript", role: "answer" },
          state: { markdown: "", signature: null },
          version: 1,
          run: null,
          owner: null,
        },
        ...[10, 20, 30, 40].map((words, update): DurableEvent => ({
          head: main,
          kind: "part",
          part,
          change: "updated",
          state: { markdown: markdown(words), signature: null },
          version: update + 2,
        })),
        { head: main, kind: "part", part, change: "settled", commit: answered, endedAt: 0 },
        { head: main, kind: "commit", id: answered, parent: asked, run: null, body: answer },
      );
      tip = answered;
    }

    await host.kernel.store.refs.set([
      { name: headRef(session, main), target: asId(tip), expect: ref.revision, events },
    ]);
  }

  await host.close();

  return session;
}

async function attach(store: Store, session: SessionId) {
  const { handler, host } = await served({ store });
  const aborted = new AbortController();
  const started = performance.now();
  const response = await post(handler, "head.watch", { session, head: main }, {}, aborted.signal);
  assert(response.body !== null);
  let first: Json = null;

  for await (const frame of parseSse(response.body)) {
    first = frame;
    break;
  }

  const elapsed = performance.now() - started;
  aborted.abort();
  await host.close();
  const frame = decodeOutput("head.watch", first);
  assert(frame.kind === "view");

  return {
    elapsed,
    bytes: new TextEncoder().encode(JSON.stringify(first)).byteLength,
    messages: frame.view.messages.length,
  };
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

it(
  "attaches to a 10,000-message chat about as fast as to a 100-message one, its first frame within the tail's byte budget",
  { timeout: 120_000 },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "nyte-attach-"));
    folders.push(folder);
    const store = sqliteStore({ path: join(folder, "nyte.db") });
    const short = await chat(store, 100);
    const long = await chat(store, 10_000);
    const connection = await store.open();

    await attach(store, short);
    await attach(store, long);
    await expect
      .poll(async () => (await connection.checkpoints?.read(long))?.seq ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(10_000);

    const shortRuns: number[] = [];
    const longRuns: number[] = [];
    let longFrame = { bytes: 0, messages: 0 };

    for (let round = 0; round < 5; round += 1) {
      shortRuns.push((await attach(store, short)).elapsed);
      const attached = await attach(store, long);
      longRuns.push(attached.elapsed);
      longFrame = attached;
    }

    expect(await connection.checkpoints?.read(short)).toBeNull();
    expect(longFrame.messages).toBe(200);
    expect(longFrame.bytes).toBeLessThan(FRAME_BUDGET);
    expect(median(longRuns) - median(shortRuns)).toBeLessThan(ATTACH_SPREAD_MS);
    await store.close();
  },
);
