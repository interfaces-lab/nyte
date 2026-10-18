import { expect, test } from "bun:test";
import type { Job } from "@nyte-ai/core";
import { testModel } from "@nyte-ai/bench";
import { asId } from "@nyte-ai/schema";
import type { JobEnd, Json } from "@nyte-ai/schema";
import { COMPOSER_PLACEHOLDER } from "../../src/lib/constants.ts";
import { openTestHost, testEnvironment } from "../fixture/host.ts";
import type { ProviderRequest } from "../fixture/host.ts";
import { composerShows, footerShows, startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";

const THINKING_MODELS = [
  testModel("model", { reasoning: true }),
  testModel("child", { reasoning: true }),
];

const idle = (tui: Tui): Promise<void> => tui.state((store) => store.screen().run.kind === "idle");

const transcript = (request: ProviderRequest | undefined): string =>
  JSON.stringify(request?.context.messages ?? []);

const rowShowing = (frame: string, entry: string): number =>
  frame.split("\n").findIndex((line) => line.includes(entry));

const askReply = (label: string, options: readonly string[]) => ({
  content: [
    {
      type: "toolCall" as const,
      id: `ask-${label}`,
      name: "question",
      arguments: {
        questions: [
          {
            question: label,
            header: "Question",
            options: options.map((option) => ({ label: option, description: "" })),
          },
        ],
      },
    },
  ],
  stopReason: "toolUse" as const,
});

const row = (frame: string, text: string): string =>
  frame.split("\n").find((line) => line.includes(text)) ?? "";

const users = (request: ProviderRequest | undefined): number =>
  (request?.context.messages ?? []).filter((message) => message.role === "user").length;

test("the reply streams in before the provider finishes", async () => {
  await using tui = await startTui();
  await tui.ready();
  const release = Promise.withResolvers<void>();

  tui.fixture.reply({
    content: [{ type: "text", text: "Hello from the fake provider. Ready when you are." }],
    tokens: 2,
    tap: (streamed) => (streamed === 1 ? release.promise : undefined),
  });
  await tui.send("hi nyte");
  await tui.frame((frame) => frame.includes("Hello from") && !composerShows(frame, "hi nyte"));
  expect(tui.captureCharFrame()).not.toContain("Ready when you are.");

  release.resolve();
  await tui.frame((frame) => frame.includes("Ready when you are."));
  await idle(tui);
  expect(tui.fixture.requests).toHaveLength(1);
});

test("Esc stops a run, keeps the typed draft and asks the provider for nothing more", async () => {
  await using tui = await startTui();
  await tui.ready();

  tui.fixture.reply({
    content: [{ type: "text", text: "Working on it, please wait" }],
    hold: true,
  });
  await tui.send("keep working");
  await tui.frame((frame) => frame.includes("Working on"));
  await tui.mockInput.typeText("keep this draft");
  tui.press("chat.interrupt");
  await idle(tui);
  await tui.frame((frame) => composerShows(frame, "keep this draft"));
  await tui.store.settled();
  expect(tui.fixture.requests).toHaveLength(1);

  tui.press("chat.quit");
  await tui.frame((frame) => composerShows(frame, COMPOSER_PLACEHOLDER));
});

test("a long reply pages up to its first row, one wheel step moves three rows, and Ctrl+End returns", async () => {
  await using tui = await startTui();
  await tui.ready();

  const rows = Array.from(
    { length: 150 },
    (_, index) => `list-row-${String(index).padStart(3, "0")}`,
  );

  tui.fixture.reply({ content: [{ type: "text", text: rows.join("\n") }] });
  await tui.send("print the long list");
  await tui.frame((frame) => frame.includes("list-row-149"));
  await idle(tui);

  for (let presses = 0; !tui.captureCharFrame().includes("list-row-000"); presses++) {
    expect(presses).toBeLessThan(30);
    const before = tui.captureCharFrame();
    tui.press("chat.scroll.page.up");
    await tui.frame((frame) => frame !== before && frame.includes("ctrl+end latest"));
  }

  const top = tui.captureCharFrame();
  const anchor = rowShowing(top, "list-row-010");

  expect(anchor).toBeGreaterThan(3);
  await tui.mockMouse.scroll(10, 10, "down");
  const moved = await tui.frame((frame) => frame !== top);

  expect(rowShowing(moved, "list-row-010")).toBe(anchor - 3);
  tui.press("chat.scroll.latest");
  await tui.frame((frame) => frame.includes("list-row-149") && !frame.includes("ctrl+end latest"));
});

test("the model picker and Shift+Tab choose the next request's model and thinking level", async () => {
  await using fixture = await openTestHost({ models: THINKING_MODELS });
  await using tui = await startTui({ fixture });
  await tui.ready();

  await tui.send("/model");
  await tui.frame(
    (frame) => frame.includes("Type to search") && frame.includes("test/model · Minimal"),
  );
  tui.press("model.next");
  await tui.frame((frame) => frame.includes("test/child · Minimal"));
  tui.press("picker.accept");
  await tui.frame(
    (frame) => !frame.includes("Type to search") && footerShows(frame, "child", "minimal"),
  );
  tui.press("chat.thinking.cycle");
  await tui.frame((frame) => footerShows(frame, "child", "low"));
  expect(fixture.requests).toHaveLength(0);

  fixture.reply({ content: [{ type: "text", text: "The child model answered." }] });
  await tui.send("which model is this");
  await tui.frame((frame) => frame.includes("The child model answered."));
  expect(fixture.requests[0]?.model.id).toBe("child");
  expect(fixture.requests[0]?.options?.reasoning).toBe("low");
});

test("a run keeps its thinking level while Shift+Tab sets the next; a queued follow-up waits and gets it", async () => {
  await using fixture = await openTestHost({ models: THINKING_MODELS });
  await using tui = await startTui({ fixture });
  await tui.ready();
  const release = Promise.withResolvers<void>();

  await tui.send("/effort low");
  await tui.frame((frame) => footerShows(frame, "model", "low"));
  fixture.reply(
    { content: [{ type: "text", text: "The original run continues" }], until: release.promise },
    { content: [{ type: "text", text: "The queued follow-up arrived." }] },
  );
  await tui.send("keep working");
  await tui.frame((frame) => frame.includes("The original run continues"));
  tui.press("chat.thinking.cycle");
  await tui.frame((frame) => footerShows(frame, "model", "medium"));
  await tui.mockInput.typeText("queued follow-up");
  tui.press("chat.queue.submit");
  await tui.frame(
    (frame) =>
      !composerShows(frame, "queued follow-up") &&
      frame.split("\n").some((line) => line.includes("↓ queued follow-up")),
  );
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]?.options?.reasoning).toBe("low");

  release.resolve();
  await tui.frame((frame) => frame.includes("The queued follow-up arrived."));
  await idle(tui);
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[1]?.options?.reasoning).toBe("medium");
});

test("a picked answer and an answer in the user's own words reach the model without a user message", async () => {
  await using tui = await startTui();
  await tui.ready();

  tui.fixture.reply(
    askReply("Choose a test answer", ["First", "Second"]),
    askReply("Name a test colour", ["Red", "Blue"]),
    { content: [{ type: "text", text: "You answered both." }] },
  );
  await tui.send("ask me something");
  await tui.frame(
    (frame) => frame.includes("Choose a test answer") && frame.includes("Type an answer"),
  );
  tui.press("picker.next");
  await tui.frame((frame) => frame.split("\n").some((line) => /❯.*Second/u.test(line)));
  tui.press("picker.accept");
  await tui.frame((frame) => frame.includes("Name a test colour"));
  tui.press("picker.close");
  await tui.frame((frame) => frame.includes("Type an answer, or press"));
  await tui.send("Green");
  await tui.frame((frame) => frame.includes("You answered both."));
  await idle(tui);

  const [asked, second, answered] = tui.fixture.requests;

  expect(transcript(second)).toContain("Second");
  expect(transcript(answered)).toContain("Green");
  expect(users(answered)).toBe(users(asked));
});

test("a ! command runs locally, Esc stops it, and kept output rides with the next message as one block", async () => {
  await using tui = await startTui();
  await tui.ready();

  await tui.mockInput.typeText("!sleep 30");
  await tui.frame((frame) => frame.includes("enter run locally"));
  tui.mockInput.pressEnter();
  await tui.frame((frame) => frame.includes("esc stop command"));
  tui.press("chat.interrupt");
  await tui.frame((frame) => frame.split("\n").some((line) => line.includes("✗ !")));
  expect(tui.shell.stopped).toEqual([tui.shell.started[0]?.id]);

  await tui.send("!echo kept");
  await tui.until(() => tui.shell.started.length === 2);
  tui.shell.finish(tui.shell.started[1]?.id ?? "", { kind: "exited", code: 0 }, "kept\n");
  await tui.frame((frame) => composerShows(frame, "[Shell echo kept] "));

  tui.fixture.reply({ content: [{ type: "text", text: "The shell output arrived." }] });
  await tui.send("with the shell output");
  await tui.frame((frame) => frame.includes("The shell output arrived."));

  const prompt = transcript(tui.fixture.requests[0]);

  expect(tui.fixture.requests).toHaveLength(1);
  expect(prompt).toContain(String.raw`<shell command=\"echo kept\" exit=\"0\">\nkept\n</shell>`);
  expect(prompt.match(/<shell /gu)).toHaveLength(1);
});

test("a new session's first message lands in the transcript at once at the level chosen before it", async () => {
  await using fixture = await openTestHost({ models: THINKING_MODELS });
  await using tui = await startTui({ fixture });
  await tui.ready();
  const pending = new Set<string>();

  await tui.send("/effort low");
  await tui.frame((frame) => footerShows(frame, "model", "low"));
  fixture.reply({ content: [{ type: "text", text: "A new session answered." }] });
  await tui.send("first message of a new session");
  await tui.until(() => {
    const frame = tui.captureCharFrame();

    for (const line of frame.split("\n"))
      if (/^\s*[↑↓…] first message/u.test(line)) pending.add(line.trim());

    return frame.includes("A new session answered.");
  });

  expect([...pending]).toEqual([]);
  expect(fixture.requests[0]?.options?.reasoning).toBe("low");
});

test("a background subagent's report wakes the finished parent and shows as a report, not a user message", async () => {
  await using tui = await startTui();
  await tui.ready();
  const release = Promise.withResolvers<void>();

  const route = (request: ProviderRequest) => {
    const seen = transcript(request);

    if (!seen.includes("start a background helper"))
      return {
        content: [{ type: "text" as const, text: "Child finished the task." }],
        until: release.promise,
      };

    if (seen.includes("Child finished the task."))
      return { content: [{ type: "text" as const, text: "The helper reported back." }] };

    if (seen.includes("Started subagent"))
      return { content: [{ type: "text" as const, text: "Helper started in the background." }] };

    return toolCall("create", { title: "Helper", prompt: "do the child task" });
  };

  tui.fixture.reply(route, route, route, route);
  await tui.send("start a background helper");
  await tui.frame((frame) => frame.includes("Helper started in the background."));
  await idle(tui);
  release.resolve();
  await tui.frame(
    (frame) =>
      frame.includes("The helper reported back.") &&
      frame.split("\n").some((line) => line.trim() === "↳ Finished Helper"),
  );
  await idle(tui);

  const woken = tui.fixture.requests.find((request) =>
    transcript(request).includes("Child finished the task."),
  );

  expect(tui.captureCharFrame()).not.toMatch(/Child \S+ completed:/u);
  expect(woken?.context.messages.some((message) => message.role === "user")).toBe(true);
  expect(transcript(woken)).toContain("Child finished the task.");
});

test("Esc stops a run while its bash tool streams; the process ends, the draft stays and nothing more is asked", async () => {
  const stopped = Promise.withResolvers<void>();

  await using fixture = await openTestHost({
    environment: testEnvironment(async (_command, options) => heartbeat(options?.signal, stopped)),
  });

  await using tui = await startTui({ fixture });
  await tui.ready();

  fixture.reply(toolCall("bash", { command: "heartbeat" }));
  await tui.send("run the heartbeat");
  await tui.frame((frame) => frame.includes("tick 2"));
  await tui.mockInput.typeText("keep this draft");
  tui.press("chat.interrupt");
  await stopped.promise;
  await idle(tui);
  await tui.frame((frame) => composerShows(frame, "keep this draft"));
  await tui.store.settled();

  expect(fixture.requests).toHaveLength(1);
});

test("a grouped question takes several picks on one question, keeps them through Back, and sends them all", async () => {
  await using tui = await startTui();
  await tui.ready();

  tui.fixture.reply(
    toolCall("question", {
      questions: [
        {
          question: "Pick toppings",
          header: "Toppings",
          options: ["Cheese", "Olives", "Basil"].map((label) => ({ label, description: "" })),
          multiple: true,
        },
        {
          question: "Pick a size",
          header: "Size",
          options: ["Small", "Large"].map((label) => ({ label, description: "" })),
        },
      ],
    }),
    { content: [{ type: "text", text: "Order placed." }] },
  );
  await tui.send("order a pizza");
  await tui.frame((frame) => frame.includes("1/2 · Pick toppings"));
  tui.press("picker.accept");
  await tui.frame((frame) => row(frame, "Cheese").includes("✓"));
  tui.press("picker.next");
  tui.press("picker.next");
  tui.press("picker.accept");
  await tui.frame((frame) => row(frame, "Basil").includes("✓"));
  tui.press("picker.next");
  tui.press("picker.next");
  tui.press("picker.accept");
  await tui.frame((frame) => frame.includes("2/2 · Pick a size") && frame.includes("Back"));

  for (let step = 0; step < 4; step++) tui.press("picker.next");
  await tui.frame((frame) => /❯.*Back/u.test(row(frame, "Back")));
  tui.press("picker.accept");
  await tui.frame(
    (frame) =>
      frame.includes("1/2 · Pick toppings") &&
      row(frame, "Cheese").includes("✓") &&
      row(frame, "Basil").includes("✓") &&
      !row(frame, "Olives").includes("✓"),
  );

  for (let step = 0; step < 4; step++) tui.press("picker.next");
  tui.press("picker.accept");
  await tui.frame((frame) => frame.includes("2/2 · Pick a size"));
  tui.press("picker.next");
  tui.press("picker.accept");
  await tui.frame((frame) => frame.includes("Order placed."));
  await idle(tui);

  const result = tui.fixture.requests[1]?.context.messages.find(
    (message) => message.role === "toolResult",
  );

  expect(JSON.stringify(result?.content)).toBe(
    JSON.stringify([{ type: "text", text: "Pick toppings: Basil, Cheese\nPick a size: Large" }]),
  );
});

function toolCall(name: string, args: Readonly<Record<string, Json>>) {
  return {
    content: [{ type: "toolCall" as const, id: `call-${name}`, name, arguments: args }],
    stopReason: "toolUse" as const,
  };
}

function heartbeat(signal: AbortSignal | undefined, stopped: PromiseWithResolvers<void>): Job {
  const ended = Promise.withResolvers<JobEnd>();
  const stop = new AbortController();
  const done = AbortSignal.any(signal === undefined ? [stop.signal] : [stop.signal, signal]);

  done.addEventListener(
    "abort",
    () => {
      stopped.resolve();
      ended.resolve({ kind: "exited", code: null, reason: "terminated" });
    },
    { once: true },
  );

  return {
    id: asId("job-heartbeat"),
    key: null,
    write: async () => undefined,
    async *output() {
      for (let tick = 1; !done.aborted; tick++) {
        yield { kind: "bytes", data: new TextEncoder().encode(`tick ${String(tick)}\n`) };
        await Bun.sleep(5);
      }

      yield { kind: "exit", code: null };
    },
    resize: async () => ({ kind: "not-pty" }),
    idle: async () => false,
    async stop() {
      stop.abort();

      return { kind: "settled", outcome: await ended.promise };
    },
    settled: () => ended.promise,
    close: async () => stop.abort(),
    [Symbol.asyncDispose]: async () => stop.abort(),
  };
}
