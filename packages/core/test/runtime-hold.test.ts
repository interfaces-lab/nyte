import { asId, asSeq, standard } from "@nyte-ai/schema";
import type { DurableEvent, Infer, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { Kernel } from "../src/contract/kernel.ts";
import type { Plugin, ToolDefinition } from "../src/index.ts";
import { world } from "./fake-env.ts";
import { fakeModels, open } from "./fake-models.ts";
import { main, until } from "./harness.ts";

const nothing = standard(Type.Object({}));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const echo: ToolDefinition<Infer<typeof nothing>> = {
  name: "echo",
  description: "The echo tool.",
  parameters: nothing,
  class: () => ({ kind: "custom", label: "echo" }),
  replay: "safe",
  execute: async () => ({ content: [{ kind: "text", text: "echo ran" }] }),
};

const gate = (seen: string[]): Plugin<"core"> => ({
  id: "shell-gate",
  hooks: {
    before_tool: (call) => {
      seen.push(`before_tool:${call.name}`);

      return { action: "reject", reason: "The user declined." };
    },
  },
});

function slow(release: Promise<void>): Plugin<"core"> & { readonly activations: () => number } {
  let activations = 0;

  return {
    id: "slow",
    activations: () => activations,
    async activate() {
      activations += 1;

      if (activations === 2) await release;
    },
  };
}

function observer(seen: string[]): Plugin<"core"> {
  let activations = 0;

  return {
    id: "observer",
    activate(api) {
      activations += 1;
      const n = activations;
      api.hook("after_request", (event) => void seen.push(`runtime${n}:${event.step}`));
      api.hook("run_ended", (end) => void seen.push(`runtime${n}:run_ended:${end.kind}`));
    },
  };
}

async function requestSteps(kernel: Kernel, session: SessionId): Promise<readonly string[]> {
  const logged: readonly DurableEvent[] = await kernel.store.refs.log(session, asSeq(0), 1000);

  return logged.flatMap((event) =>
    event.kind === "request" ? [`${event.step}:${event.usage.total}`] : [],
  );
}

describe("runtime hold (ADV D-2 N1, N2, N4; E-2 N3)", () => {
  for (const order of ["provider-first", "slow-first"] as const)
    it(`D N1 (${order}): a call of a response overlapping a reload resolves and is gated on its request's runtime`, async () => {
      const fake = fakeModels();
      const seen: string[] = [];
      const streaming = Promise.withResolvers<void>();
      const activation = Promise.withResolvers<void>();
      const held = slow(activation.promise);
      const provider: Plugin<"core"> = { id: "provider", contribute: { tools: [echo] } };

      fake.reply(
        {
          content: [{ type: "toolCall", id: "c1", name: "echo", arguments: {} }],
          until: streaming.promise,
        },
        { content: [{ type: "text", text: "Done." }] },
      );

      const plugins =
        order === "slow-first" ? [held, provider, gate(seen)] : [provider, held, gate(seen)];
      await using host = await open(fake, { plugins });
      const session = await host.sessions.create();
      const receipt = await session.send("Go.");
      await until(() => (fake.requests.length === 1 ? true : undefined));
      void host.kernel.plugins.reload(session.id);
      await until(() => (held.activations() === 2 ? true : undefined));
      streaming.resolve();
      await until(() => (seen.length > 0 ? true : undefined));
      activation.resolve();
      expect((await receipt.settled()).kind).toBe("completed");

      const result = fake.requests[1]?.context.messages.find((m) => m.role === "toolResult");
      expect(seen).toEqual(["before_tool:echo"]);
      expect(result?.role === "toolResult" ? result.content : null).toEqual([
        { type: "text", text: "The tool call was rejected: The user declined." },
      ]);
    });

  it("D N1 control: the same gate rejects the call without a reload", async () => {
    const fake = fakeModels();
    const seen: string[] = [];
    const provider: Plugin<"core"> = { id: "provider", contribute: { tools: [echo] } };

    fake.reply(
      { content: [{ type: "toolCall", id: "c1", name: "echo", arguments: {} }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [provider, gate(seen)] });
    const session = await host.sessions.create();
    await (await session.send("Go.")).settled();
    const result = fake.requests[1]?.context.messages.find((m) => m.role === "toolResult");

    expect(seen).toEqual(["before_tool:echo"]);
    expect(result?.role === "toolResult" ? result.content : null).toEqual([
      { type: "text", text: "The tool call was rejected: The user declined." },
    ]);
  });

  it("D N1 (run_ended mid-reload): a run ending while its session reloads is observed by the runtime it ran on", async () => {
    const fake = fakeModels();
    const seen: string[] = [];
    const streaming = Promise.withResolvers<void>();
    const activation = Promise.withResolvers<void>();
    const held = slow(activation.promise);

    fake.reply({ content: [{ type: "text", text: "Answer." }], until: streaming.promise });
    await using host = await open(fake, { plugins: [held, observer(seen)] });
    const session = await host.sessions.create();
    const receipt = await session.send("Go.");
    await until(() => (fake.requests.length === 1 ? true : undefined));
    void host.kernel.plugins.reload(session.id);
    await until(() => (held.activations() === 2 ? true : undefined));
    streaming.resolve();
    expect((await receipt.settled()).kind).toBe("completed");
    await until(() => (seen.includes("runtime1:run_ended:completed") ? true : undefined));
    activation.resolve();
    await host.kernel.plugins.runtime(session.id).ready;

    expect(seen).toEqual(["runtime1:assistant", "runtime1:run_ended:completed"]);
  });

  it("D N2: a response overlapping a reload reaches its request's runtime with after_request", async () => {
    const fake = fakeModels();
    const seen: string[] = [];
    const streaming = Promise.withResolvers<void>();

    fake.reply({ content: [{ type: "text", text: "Answer." }], until: streaming.promise });
    await using host = await open(fake, { plugins: [observer(seen)] });
    const session = await host.sessions.create();
    const receipt = await session.send("Go.");
    await until(() => (fake.requests.length === 1 ? true : undefined));
    await host.kernel.plugins.reload(session.id);
    await sleep(20);
    streaming.resolve();
    expect((await receipt.settled()).kind).toBe("completed");
    await until(() => (seen.includes("runtime1:assistant") ? true : undefined));

    expect(seen.filter((entry) => entry.endsWith(":assistant"))).toEqual(["runtime1:assistant"]);
    expect(await requestSteps(host.kernel, session.id)).toEqual(["assistant:15"]);
  });

  it("D #3: a held runtime keeps its handlers after a reload until it is released", async () => {
    const fixture = await world({
      plugins: [
        {
          id: "stamp",
          hooks: {
            after_tool: (outcome) => ({ ...outcome, content: [{ kind: "text", text: "OLD" }] }),
          },
        },
      ],
    });

    const session = await fixture.host.sessions.create({ workspace: fixture.workspace });
    const old = fixture.kernel.plugins.runtime(session.id);
    await old.ready;
    const release = old.hold();
    await fixture.kernel.plugins.reload(session.id);
    await sleep(20);

    const result = await old.hooks.transform(
      "after_tool",
      { kind: "ok", content: [], output: null, parts: [] },
      { session: session.id, head: main, run: null, principal: asId("local") },
    );

    release();
    expect(result.kind === "ok" ? result.content : null).toEqual([{ kind: "text", text: "OLD" }]);
  });

  it("D N4a: a failed compaction summary is charged as a compaction request", async () => {
    const fake = fakeModels();
    const seen: string[] = [];

    const watcher: Plugin<"core"> = {
      id: "watcher",
      hooks: { after_request: (event) => void seen.push(`${event.step}:${event.usage.total}`) },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        error: "prompt is too long: 213462 tokens > 200000 maximum",
        usage: { input: 40, output: 4 },
      },
      {
        content: [{ type: "text", text: "Half a summ" }],
        error: "401 Invalid API key",
        usage: { input: 180, output: 20 },
      },
    );

    await using host = await open(fake, { plugins: [watcher] });
    const session = await host.sessions.create();
    await (await session.send("First?")).settled();
    const end = await (await session.send("Second?")).settled();

    expect(end.kind).toBe("failed");
    expect(await requestSteps(host.kernel, session.id)).toEqual([
      "assistant:15",
      "compaction:200",
      "assistant:44",
    ]);
    expect(seen).toEqual(["assistant:15", "compaction:200", "assistant:44"]);
  });

  it("E N3: a transient attach failure is retried by the next send, and a provider's plain Error is unavailable", async () => {
    const { kernel, host, provider, workspace } = await world();
    provider.failure = "The sandbox did not boot.";
    const session = await host.sessions.create({ workspace });

    await expect(session.send("Go.")).rejects.toMatchObject({
      code: "unavailable",
      message: "The sandbox did not boot.",
    });

    provider.failure = null;
    await until(() => (kernel.plugins.runtimes().has(session.id) ? undefined : true));
    const receipt = await session.send("Go.");

    expect(receipt.message).toBeDefined();
    expect((await session.info()).activation).toEqual({ kind: "active" });
  });
});
