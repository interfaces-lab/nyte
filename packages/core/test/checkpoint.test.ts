import { asId, asSeq } from "@nyte-ai/schema";
import type { HeadName, Seq } from "@nyte-ai/schema";
import { assert, expect, it } from "vitest";
import { until } from "../src/harness.ts";
import { memoryStore } from "../src/store.ts";
import type { Plugin, StoreConnection } from "../src/index.ts";
import { addWorkspace, createDisk, fakeProvider } from "./fake-env.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";
import { echo } from "./turn-support.ts";

const main: HeadName = asId("main");

const echoing: Plugin<"core"> = { id: "echoing", contribute: { tools: [echo] } };

function reading(connection: StoreConnection, after: Seq[]) {
  return {
    open: async (): Promise<StoreConnection> => ({
      ...connection,
      refs: {
        ...connection.refs,
        log: (session, from, limit) => {
          after.push(from);

          return connection.refs.log(session, from, limit);
        },
      },
    }),
    close: async () => undefined,
  };
}

it("restores a settled fold from its checkpoint and replays only the log past it", async () => {
  const store = memoryStore();
  const connection = await store.open();
  const fake = fakeModels({ models: [testModel("model", { contextWindow: 10_000_000 })] });

  fake.reply(
    {
      content: [
        { type: "thinking", thinking: "Echo it." },
        {
          type: "toolCall",
          id: "call-1",
          name: "echo",
          arguments: { text: "x".repeat(1_100_000) },
        },
      ],
    },
    { content: [{ type: "text", text: "Echoed." }] },
    { content: [{ type: "toolCall", id: "call-2", name: "echo", arguments: { text: "again" } }] },
    { content: [{ type: "text", text: "Done." }] },
  );

  const writer = await open(fake, { store, plugins: [echoing] });
  const { session, receipt } = await writer.sessions.start({ content: "Echo a lot." });
  await receipt.settled();

  const checkpoint = await until(
    async () => (await connection.checkpoints?.read(session.id)) ?? undefined,
  );

  await (await session.head(main).send("Echo again.")).settled();
  await writer.close();

  expect(await connection.refs.tail(session.id)).toBeGreaterThan(checkpoint.seq);

  const replayed: Seq[] = [];

  await using restored = await open(fakeModels(), {
    store: reading(connection, replayed),
    plugins: [echoing],
  });

  const view = await restored.session(session.id).head(main).view({ tail: 1_000 });

  await using cold = await open(fakeModels(), {
    store: reading({ ...connection, checkpoints: undefined }, []),
    plugins: [echoing],
  });

  expect(replayed).toContain(checkpoint.seq);
  expect(replayed).not.toContain(asSeq(0));
  expect(
    view.messages.map((message) => (message.kind === "user" ? message.content : message.partKind)),
  ).toEqual(["Echo a lot.", "thinking", "tool", "text", "Echo again.", "tool", "text"]);
  expect(view).toEqual(await cold.session(session.id).head(main).view({ tail: 1_000 }));
});

it("folds the log from its start past a checkpoint it cannot read", async () => {
  const store = memoryStore();
  const connection = await store.open();
  const fake = fakeModels();
  fake.reply({ content: [{ type: "text", text: "Hello." }] });
  const writer = await open(fake, { store });
  const { session, receipt } = await writer.sessions.start({ content: "Hi." });
  await receipt.settled();
  await writer.close();
  const tail = await connection.refs.tail(session.id);
  assert(connection.checkpoints !== undefined);
  await connection.checkpoints.write(session.id, { seq: tail, body: '{"version":0}' });

  const replayed: Seq[] = [];
  await using reader = await open(fakeModels(), { store: reading(connection, replayed) });
  const view = await reader.session(session.id).head(main).view();

  expect(replayed).toContain(asSeq(0));
  expect(view.seq).toBe(tail);
  expect(view.messages).toHaveLength(2);
});

it("counts no background work on a head restored from a checkpoint taken while a job ran", async () => {
  const store = memoryStore();
  const connection = await store.open();
  const disk = createDisk();
  disk.directories.add("/work/project");

  const environment: Plugin<"core"> = {
    id: "fake-environment",
    environment: fakeProvider(disk),
  };

  const fake = fakeModels();
  fake.reply(
    { content: [{ type: "text", text: "Hello." }] },
    { content: [{ type: "text", text: "Read it." }] },
  );
  const writer = await open(fake, { store, plugins: [environment] });
  const workspace = await addWorkspace(writer);
  const { session, receipt } = await writer.sessions.start({ workspace, content: "Hi." });
  await receipt.settled();
  await writer.workspace(workspace).jobs.start({ command: "pnpm dev", session: session.id });
  await (await session.head(main).send("x".repeat(1_100_000))).settled();

  expect((await session.info()).heads[0]?.background).toEqual({ working: 1, waiting: 0 });
  await until(async () => (await connection.checkpoints?.read(session.id)) ?? undefined);
  await writer.close();

  await using reader = await open(fakeModels(), { store, plugins: [environment] });
  const view = await reader.session(session.id).head(main).view();

  expect(view.background).toEqual([]);
  expect((await reader.session(session.id).info()).heads[0]?.background).toEqual({
    working: 0,
    waiting: 0,
  });
});
