import assert from "node:assert/strict";
import { sessionId } from "@nyte-ai/protocol";
import { SqliteStore } from "../src/kernel/sqlite.ts";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import { contextCommits } from "../src/kernel/graph.ts";
import { COMPACTION_SUMMARY_PREFIX, contextMessages, modelContext } from "../src/kernel/context.ts";
import { transcriptFromCommits } from "../src/kernel/views/transcript.ts";
import { historyFixture, MODEL, SEED } from "./fixtures.ts";
import { summarize, timed, type Repetitions } from "./measure.ts";

export async function histories(count: number, repetitions: Repetitions) {
  const rows = [];
  for (const checkpoint of [false, true]) {
    const fixture = historyFixture(count, checkpoint);
    const store = new SqliteStore(":memory:");
    let nyte: Awaited<ReturnType<typeof createNyte>> | undefined;
    try {
      const session = await store.create({ id: SEED });
      assert.deepEqual(
        await session.objects.put(fixture.items.map((item) => item.commit)),
        fixture.items.map((item) => item.oid),
      );
      const tip = fixture.items.at(-1)?.oid;
      assert.ok(tip);
      assert.equal(
        (
          await session.refs.update([{ name: "refs/heads/main", from: null, to: tip }], {
            reason: "benchmark-seed",
          })
        ).ok,
        true,
      );
      nyte = await createNyte({
        store,
        model: MODEL,
        resolveActivation: () => ({ kind: "inactive" }),
        models: {
          getModel: () => MODEL,
          getModels: () => [MODEL],
          getAvailable: async () => [MODEL],
        },
        streamFn: () => {
          throw new Error("Provider execution is forbidden in this benchmark");
        },
      });
      const client = nyte;
      const input = { sessionId: sessionId(SEED) };
      const expectedTranscript = transcriptFromCommits(fixture.items);
      // Adoption and activation resolution are setup even when --warmups=0.
      const initial = await client.sessions.snapshot(input);
      assert.ok(initial);
      assert.deepEqual(initial.transcript, expectedTranscript);
      const expectedEntries = checkpoint
        ? fixture.items.slice(fixture.metadata.checkpointAfterMessages ?? 0)
        : fixture.items;
      const expectedMessages = checkpoint
        ? [
            {
              role: "user",
              content: [
                { type: "text", text: `${COMPACTION_SUMMARY_PREFIX}Synthetic summary\n</summary>` },
              ],
              timestamp: expectedEntries[0]?.commit.at,
            },
            ...fixture.messages.slice(fixture.metadata.retainedTailStart ?? 0),
          ]
        : fixture.messages;
      const contextSamples = [];
      const snapshotSamples = [];
      for (let index = -repetitions.warmups; index < repetitions.samples; index++) {
        const context = await timed(async () => {
          const entries = await contextCommits(session.objects, tip);
          const commits = entries.map((item) => item.commit);
          return {
            entries,
            messages: contextMessages(commits),
            model: modelContext(commits, {
              provider: MODEL.provider,
              api: MODEL.api,
              model: MODEL.id,
            }),
          };
        });
        assert.deepEqual(context.result.entries, expectedEntries);
        assert.deepEqual(context.result.messages, expectedMessages);
        assert.deepEqual(context.result.model, { messages: expectedMessages });
        assert.equal(context.result.entries.length, fixture.metadata.contextEntries);
        assert.equal(context.result.messages.length, fixture.metadata.contextMessages);
        const snapshot = await timed(() => client.sessions.snapshot(input));
        assert.ok(snapshot.result);
        assert.deepEqual(snapshot.result, initial);
        assert.equal(snapshot.result.tip, tip);
        assert.equal(snapshot.result.seq, 1);
        assert.deepEqual(snapshot.result.pending, []);
        assert.equal(snapshot.result.transcript.length, count + (checkpoint ? 1 : 0));
        assert.equal((await session.objects.list()).length, fixture.metadata.storedCommits);
        if (index >= 0) {
          contextSamples.push(context.measurement);
          snapshotSamples.push(snapshot.measurement);
        }
      }
      const metadata = {
        fixture: fixture.metadata,
        memoryMode: "memory",
        warmups: repetitions.warmups,
      };
      rows.push({
        operation: "contextCommits + contextMessages + modelContext",
        ...metadata,
        ...summarize(contextSamples),
      });
      rows.push({
        operation: "nyte.sessions.snapshot, adopted inactive session",
        ...metadata,
        ...summarize(snapshotSamples),
      });
    } finally {
      try {
        await nyte?.close();
      } finally {
        await store.close();
      }
    }
  }
  return rows;
}
