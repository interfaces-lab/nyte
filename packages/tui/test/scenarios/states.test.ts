import { expect, test } from "bun:test";
import { lastUserText } from "@nyte-ai/bench";
import { listen } from "@nyte-ai/host";
import { sdk } from "@nyte-ai/sdk/client";
import { openTestHost } from "../fixture/host.ts";
import { followedSession } from "../../src/model/state.ts";
import { startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";
import { SAMPLE_ANSWER, saveFrame, saveProof } from "./scenario.ts";

const LONG_LINES = 3_000;

async function answered(tui: Tui, prompt: string, answer: string, shows: string): Promise<void> {
  tui.fixture.reply({ content: [{ type: "text", text: answer }] });
  await tui.send(prompt);
  await tui.frame((frame) => frame.includes(shows));
  await tui.state((store) => store.screen().run.kind === "idle");
  await tui.renderOnce();
}

test("steering: a message sent mid-run is a pending prompt from its send, never a queue row", async () => {
  await using tui = await startTui();
  await tui.ready();
  const held = Promise.withResolvers<void>();
  tui.fixture.reply({
    content: [{ type: "text", text: SAMPLE_ANSWER }],
    tokens: 8,
    until: held.promise,
  });
  await tui.send("show me the plan");
  await tui.frame((frame) => frame.includes("another step"));
  tui.fixture.reply({ content: [{ type: "text", text: "Switched to tabs." }] });

  const steer = "use tabs instead";
  const queued: string[] = [];

  const pendingPrompt = (): boolean =>
    tui.store
      .screen()
      .transcript.rows.some(
        (row) => row.kind === "prompt" && row.pending && row.message.content === steer,
      );

  await tui.send(steer);
  await tui.until(() => {
    if (tui.store.screen().queue.some((row) => row.text === steer)) queued.push(steer);

    return (
      pendingPrompt() &&
      followedSession(tui.store.state())?.view?.messages.some(
        (message) =>
          message.kind === "user" &&
          message.content === steer &&
          message.status.kind === "pending" &&
          message.status.schedule.kind === "joined",
      ) === true
    );
  });
  await saveFrame(tui, "state-steering");

  expect(queued).toEqual([]);
  held.resolve();
  await tui.frame((frame) => frame.includes("Switched to tabs."));
  await tui.state((store) => store.screen().run.kind === "idle");

  expect(queued).toEqual([]);
  expect(pendingPrompt()).toBe(false);
});

test("error, transient: a provider overload shows its retry", async () => {
  await using tui = await startTui();
  await tui.ready();
  tui.fixture.reply({ error: "overloaded_error: the provider is overloaded, try again" });
  await tui.send("hello");
  await tui.frame((frame) => frame.includes("Retrying in"));
  await saveFrame(tui, "state-error-retrying");
});

test("error: a lasting provider error ends the run with its message", async () => {
  await using tui = await startTui();
  await tui.ready();
  tui.fixture.reply({ error: "invalid_request_error: messages.0.content is malformed" });
  await tui.send("again");
  await tui.frame((frame) => frame.includes("messages.0.content is malformed"));
  await tui.state((store) => store.screen().run.kind === "idle");
  await tui.renderOnce();
  await saveFrame(tui, "state-error");
});

test("offline, then back: a message sent while the service is down waits as pending and lands once it listens again", async () => {
  await using fixture = await openTestHost();
  const token = "t".repeat(40);

  const first = await listen(fixture.host, {
    transport: { kind: "http", port: 0 },
    auth: { kind: "token", token },
  });

  const url = String(first.address);
  const connection = await sdk.connect({ url, credentials: { kind: "token", token } });
  await using tui = await startTui({
    host: connection,
    endpoint: { url, token },
    size: { width: 80, height: 24 },
  });
  await tui.ready();
  fixture.reply({ content: [{ type: "text", text: "first answer" }] });
  await tui.send("hello");
  await tui.frame((frame) => frame.includes("first answer"));
  await tui.state((store) => store.screen().run.kind === "idle");
  await first.close();

  await tui.send("are you there");
  await tui.frame((frame) => frame.includes("… are you there"));
  await saveFrame(tui, "state-offline");

  const second = await listen(fixture.host, {
    transport: { kind: "http", port: Number(new URL(url).port) },
    auth: { kind: "token", token },
  });

  fixture.reply({ content: [{ type: "text", text: "back again" }] });
  await tui.frame((frame) => frame.includes("back again"));

  await saveProof("state-offline-gap", {
    step: "The service connection drops",
    shows:
      "The unsent message with a leading … and nothing else: no offline or reconnecting mark until it lands.",
    frame: "state-offline",
    verdict: "gap",
    why: "The footer has no connection mark; the SDK's own reconnect to the service is not shown.",
  });

  await tui.dispose();
  await connection.close();
  await second.close();
  expect(lastUserText(await fixture.requested(2))).toBe("are you there");
  expect(fixture.requests).toHaveLength(2);
}, 30_000);

test("very long content: a 3,000-line answer paints its tail", async () => {
  await using tui = await startTui();
  await tui.ready();

  const answer = Array.from(
    { length: LONG_LINES },
    (_, line) => `line ${String(line + 1)}: ${"lorem ipsum dolor sit amet ".repeat(3)}`,
  ).join("\n\n");

  await answered(tui, "long please", answer, `line ${String(LONG_LINES)}:`);
  await saveFrame(tui, "state-long-content");

  const rows = tui.captureCharFrame().split("\n");
  expect(rows.at(-2)).toContain("enter send");
  expect(rows.at(-3)).toContain("╰─ ");
});
