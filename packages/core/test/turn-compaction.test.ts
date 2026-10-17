import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { compaction, isPart, text } from "../src/index.ts";
import type { Plugin } from "../src/index.ts";
import { fakeModels, open } from "./fake-models.ts";
import { label, until } from "../src/harness.ts";
import { recorder, events, sent, lastUserText } from "./turn-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("turn compaction", () => {
  it("anchors a run's first estimate on the usage its last response stored, not on the transcript's characters", async () => {
    const fake = fakeModels();

    const policy: Plugin<"core"> = {
      id: "policy",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 100_000, compactAt: 5_000 },
        ],
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "Short." }], usage: { input: 6_000, output: 5 } },
      { content: [{ type: "text", text: "They asked once." }] },
      { content: [{ type: "text", text: "Second answer." }] },
    );

    await using host = await open(fake, { plugins: [policy] });
    const { session, receipt: started } = await host.sessions.start({ content: "First?" });
    await started.settled();
    await (await session.send("Second?")).settled();

    expect(fake.requests).toHaveLength(3);
    expect(sent(fake, 2)).toEqual([
      "system",
      "user:The earlier conversation was summarised to fit the context window. The summary:\n\nThey asked once.",
      "user:Second?",
    ]);
  });

  it("compacts at the threshold and writes the part and its commit", async () => {
    const fake = fakeModels();
    const { plugin, seen } = recorder();

    const policy: Plugin<"core"> = {
      id: "policy",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 2_000, compactAt: 100 },
        ],
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }], usage: { input: 150, output: 5 } },
      {
        content: [{ type: "text", text: "They asked a first question." }],
        usage: { input: 40, output: 8 },
      },
      { content: [{ type: "text", text: "Second answer." }] },
    );

    await using host = await open(fake, { plugins: [plugin, policy] });
    const { session, receipt: started } = await host.sessions.start({
      content: "First question?",
    });
    await started.settled();
    const logged = events(host.kernel, session.id);
    const end = await (await session.send("Second question?")).settled();

    assert(end.kind === "completed");
    expect(end.usage.input).toBe(10 + 40);
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests[1].context.messages.at(-1)).toMatchObject({ role: "user" });
    expect(sent(fake, 2)).toEqual([
      "system",
      "user:The earlier conversation was summarised to fit the context window. The summary:\n\nThey asked a first question.",
      "user:Second question?",
    ]);

    const view = await session.view();
    const note = view.messages.find((message) => isPart(message, compaction));
    assert(note !== undefined && isPart(note, compaction));

    expect(note).toMatchObject({ role: "note", status: { kind: "settled" } });
    expect(note.state).toMatchObject({
      summary: "They asked a first question.",
      material: null,
      usage: { input: 40, output: 8 },
    });

    const labels = logged.map(label);
    const created = labels.findIndex((entry) => entry === "part:created");

    expect(labels.slice(created, created + 5)).toEqual([
      "part:created",
      "part:updated",
      "request",
      "part:settled",
      "commit",
    ]);
    const asked = view.messages.findLast((message) => message.kind === "user");

    assert(asked?.kind === "user" && asked.status.kind === "landed");
    expect(logged[created]).toMatchObject({
      partKind: "compaction",
      state: { summary: null },
      run: asked.status.run,
    });

    const committed = logged.find(
      (event) => event.kind === "commit" && event.body.kind === "compaction",
    );

    assert(committed?.kind === "commit" && committed.body.kind === "compaction");
    expect(committed.body.part).toBe(note.part);
    expect(committed.body.replaces).toHaveLength(2);
    expect(seen).toContain("before_compaction:threshold:2:1");
    expect(seen).toContain("after_request:compaction:48");
    expect(
      logged
        .filter((event) => event.kind === "request")
        .map((event) => event.kind === "request" && event.step),
    ).toEqual(["compaction", "assistant"]);
  });

  it("judges the threshold from the provider's reported usage, not a character count of the history", async () => {
    const fake = fakeModels();

    const policy: Plugin<"core"> = {
      id: "policy",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 10_000, compactAt: 2_000 },
        ],
      },
    };

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      {
        content: [{ type: "toolCall", id: "a", name: "echo", arguments: { text: "a" } }],
        usage: { input: 2_500, output: 8 },
      },
      { content: [{ type: "text", text: "They asked a first question." }] },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { plugins: [recorder().plugin, policy] });
    const { session, receipt: started } = await host.sessions.start({
      content: "First question?",
    });
    await started.settled();
    expect((await (await session.send("Second question?")).settled()).kind).toBe("completed");

    expect(fake.requests).toHaveLength(4);
    expect(lastUserText(fake, 2)).toContain("First question?");
    expect(sent(fake, 3)[1]).toContain("The earlier conversation was summarised");
    expect(
      fake.requests[3].context.messages.findLast((message) => message.role === "assistant"),
    ).toMatchObject({ usage: { input: 2_500, output: 8 } });
  });

  it("keeps a long tool result's start and end in the compaction prompt", async () => {
    const fake = fakeModels();
    const long = `BEGIN${"x".repeat(5_000)}FINISHED`;

    const policy: Plugin<"core"> = {
      id: "policy",
      contribute: {
        modelContext: [
          { model: { provider: "test", id: "model" }, contextWindow: 8_000, compactAt: 300 },
        ],
      },
    };

    fake.reply(
      { content: [{ type: "toolCall", id: "a", name: "echo", arguments: { text: long } }] },
      { content: [{ type: "text", text: "They echoed a long text." }] },
      { content: [{ type: "text", text: "Echoed." }] },
    );

    await using host = await open(fake, { plugins: [recorder().plugin, policy] });
    const { receipt: started } = await host.sessions.start({
      content: "Echo it.",
    });
    await started.settled();

    const prompt = lastUserText(fake, 1);

    expect(prompt).toContain("echo returned: echo: BEGIN");
    expect(prompt).toContain("characters omitted");
    expect(prompt).toContain("xFINISHED");
  });

  it("compacts once on a context overflow and retries", async () => {
    const fake = fakeModels();

    fake.reply(
      { content: [{ type: "text", text: "First answer." }] },
      { error: "prompt is too long: 213462 tokens > 200000 maximum" },
      { content: [{ type: "text", text: "Summary of the first exchange." }] },
      { content: [{ type: "text", text: "Second answer." }] },
    );

    await using host = await open(fake);
    const { session, receipt: started } = await host.sessions.start({ content: "First?" });
    await started.settled();
    const logged = events(host.kernel, session.id);
    const end = await (await session.send("Second?")).settled();

    expect(end.kind).toBe("completed");
    expect(
      logged.find((event) => event.kind === "run" && event.change === "retrying"),
    ).toMatchObject({
      attempt: 2,
    });
    expect(sent(fake, 3)).toEqual([
      "system",
      "user:The earlier conversation was summarised to fit the context window. The summary:\n\nSummary of the first exchange.",
      "user:Second?",
    ]);
    expect((await session.view()).messages.some((message) => isPart(message, compaction))).toBe(
      true,
    );
  });

  it("fails the run when an overflow leaves nothing to compact", async () => {
    const fake = fakeModels();
    fake.reply({ error: "prompt is too long: 213462 tokens > 200000 maximum" });
    await using host = await open(fake);
    const { receipt: first } = await host.sessions.start({ content: "Only?" });
    const end = await first.settled();

    expect(end).toMatchObject({ kind: "failed", failure: { class: "context_window" } });
  });

  it("compacts by hand: started at once, then settled in the background", async () => {
    const fake = fakeModels();
    const { plugin, seen } = recorder();

    fake.reply(
      { content: [{ type: "text", text: "One." }] },
      { content: [{ type: "text", text: "Two." }] },
      { content: [{ type: "text", text: "Earlier they counted to one." }] },
      { content: [{ type: "text", text: "Three." }] },
    );

    await using host = await open(fake, { plugins: [plugin] });
    const { session, receipt } = await host.sessions.start({ content: "Count." });

    await receipt.settled();
    await (await session.send("Again.")).settled();
    const started = await session.compact({ instructions: "Keep the numbers." });

    assert(started.kind === "started");

    const note = await until(async () => {
      const message = (await session.view()).messages.find((entry) => entry.id === started.message);

      return message?.kind === "part" && message.status.kind === "settled" ? message : undefined;
    });

    expect(note).toMatchObject({
      partKind: "compaction",
      role: "note",
      state: { summary: "Earlier they counted to one.", material: null },
    });
    expect(lastUserText(fake, 2)).toContain("Follow these instructions: Keep the numbers.");
    expect(seen).toContain("before_compaction:manual:2:2");

    await (await session.send("Once more.")).settled();

    expect(sent(fake, 3)).toEqual([
      "system",
      "user:The earlier conversation was summarised to fit the context window. The summary:\n\nEarlier they counted to one.",
      "user:Again.",
      "assistant:Two.",
      "user:Once more.",
    ]);
  });

  it("summarises an abandoned path when moving back with summarize", async () => {
    const fake = fakeModels();

    fake.reply(
      { content: [{ type: "text", text: "First." }] },
      { content: [{ type: "text", text: "Second." }] },
      { content: [{ type: "text", text: "They asked a second time." }] },
      { content: [{ type: "text", text: "Fresh." }] },
    );

    await using host = await open(fake);
    const { session, receipt: started } = await host.sessions.start({ content: "One?" });
    await started.settled();
    await (await session.send("Two?")).settled();

    const first = (await session.view()).messages.find(
      (message) => isPart(message, text) && message.state.markdown === "First.",
    );

    assert(first?.kind === "part" && first.status.kind === "settled");

    const moved = await (
      await session.move(
        { kind: "commit", id: first.status.commit },
        { abandoned: { summarize: {} } },
      )
    ).settled();

    expect(moved).toMatchObject({ kind: "moved" });
    expect(lastUserText(fake, 2)).toContain("User: Two?\n\nAssistant: Second.");

    await (await session.send("Three?")).settled();

    expect(sent(fake, 3)).toEqual([
      "system",
      "user:One?",
      "assistant:First.",
      "user:The conversation moved back to an earlier point, abandoning a path. What that path did:\n\nThey asked a second time.",
      "user:Three?",
    ]);
  });
});
