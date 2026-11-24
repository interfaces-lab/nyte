import { asId } from "@nyte-ai/schema";
import type { HostActivity, SessionId } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it } from "vitest";
import { isPart, text } from "../src/index.ts";
import type { HostApi, Store } from "../src/index.ts";
import { decodeRunRecord, leaseRef, memoryStore, runRef } from "../src/store.ts";
import { main, until } from "../src/harness.ts";
import { world } from "./fake-env.ts";
import { fakeModels, open } from "./fake-models.ts";
import type { Composed, FakeModels } from "./fake-models.ts";

const closings: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closings.splice(0).reverse()) await close();
});

async function opened(fake: FakeModels, store?: Store): Promise<Composed> {
  const host = await open(fake, { store });
  closings.push(() => host.close());

  return host;
}

async function streaming(host: Composed, session: SessionId, attempt: number): Promise<void> {
  await until(async () =>
    (await host.session(session).view()).messages.some(
      (message) =>
        isPart(message, text) &&
        message.status.kind === "live" &&
        message.state.markdown !== "" &&
        message.id.includes(`:a${String(attempt)}:`),
    )
      ? true
      : undefined,
  );
}

async function runs(reply: "completed" | "held" | "retrying"): Promise<HostApi> {
  const fake = fakeModels();

  fake.reply(
    reply === "retrying"
      ? { content: [{ type: "text", text: "Half" }], error: "503 Service Unavailable" }
      : { content: [{ type: "text", text: "Done." }], hold: reply === "held" },
    { content: [{ type: "text", text: "Done." }], hold: true },
  );

  const host = await opened(fake);
  const { session, receipt } = await host.sessions.start({ content: "Go." });

  if (reply === "completed") await receipt.settled();
  else {
    const kind = reply === "held" ? "live" : "retrying";
    await until(async () => ((await session.view()).execution.kind === kind ? true : undefined));
  }

  return host.host;
}

async function jobs(job: "idle terminal" | "busy terminal" | "command" | "stopped command") {
  const { host, provider, workspace } = await world();
  const started = host.workspace(workspace).jobs;

  const handle = await started.start(
    job === "idle terminal" || job === "busy terminal"
      ? { pty: { columns: 80, rows: 24 } }
      : { command: "sleep 60" },
  );

  const process = await until(() => provider.processes[0]);
  process.idle = job === "idle terminal";

  if (job === "stopped command") await handle.stop();

  return host.host;
}

describe("host activity", () => {
  it.each<{
    readonly state: string;
    readonly server: () => Promise<HostApi>;
    readonly activity: HostActivity;
  }>([
    {
      state: "a head whose run ended",
      server: () => runs("completed"),
      activity: { runs: 0, jobs: 0 },
    },
    {
      state: "a run streaming a response",
      server: () => runs("held"),
      activity: { runs: 1, jobs: 0 },
    },
    {
      state: "a run waiting to retry",
      server: () => runs("retrying"),
      activity: { runs: 1, jobs: 0 },
    },
    {
      state: "a terminal at its prompt",
      server: () => jobs("idle terminal"),
      activity: { runs: 0, jobs: 0 },
    },
    {
      state: "a terminal running a command",
      server: () => jobs("busy terminal"),
      activity: { runs: 0, jobs: 1 },
    },
    {
      state: "a running command job",
      server: () => jobs("command"),
      activity: { runs: 0, jobs: 1 },
    },
    {
      state: "a stopped command job",
      server: () => jobs("stopped command"),
      activity: { runs: 0, jobs: 0 },
    },
  ])("counts $state as $activity", async ({ server, activity }) => {
    expect(await (await server()).activity()).toEqual(activity);
  });
});

describe("recovery after a close", () => {
  it.each<{ readonly close: "clean" | "crash"; readonly interrupted: unknown }>([
    { close: "clean", interrupted: undefined },
    { close: "crash", interrupted: { count: 1, mark: expect.any(String) } },
  ])(
    "a $close close mid-response leaves the next claim counting $interrupted",
    async ({ close, interrupted }) => {
      const fake = fakeModels();
      const shared = memoryStore();
      let crashed = false;

      const store: Store = {
        ...shared,
        async open() {
          const backing = await shared.open();

          return {
            ...backing,
            refs: {
              ...backing.refs,
              async set(updates) {
                if (crashed) throw new Error("The host stopped.");

                return backing.refs.set(updates);
              },
            },
          };
        },
      };

      const id = asId<"session">("chat");
      fake.reply({ content: [{ type: "text", text: "A partial answer" }], hold: true });
      const first = await open(fake, { store });
      await first.sessions.start({ id, content: "Go." });
      await streaming(first, id, 1);
      crashed = close === "crash";
      await first.close();

      if (close === "crash") {
        crashed = false;
        await (await shared.open()).refs.set([{ name: leaseRef(id, main), target: null }]);
      }

      fake.reply({ content: [{ type: "text", text: "The rest" }], hold: true });
      const second = await opened(fake, store);
      await streaming(second, id, 2);

      const execution = (await second.session(id).view()).execution;
      assert(execution.kind === "live");
      const ref = await second.kernel.store.refs.get(runRef(id, execution.run.id));
      assert(ref?.target);
      const record = decodeRunRecord(await second.kernel.store.objects.get(ref.target));

      expect({ interrupted: record?.interrupted, released: record?.released }).toEqual({
        interrupted,
        released: undefined,
      });
    },
  );
});
