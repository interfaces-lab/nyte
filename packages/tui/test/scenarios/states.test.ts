import { expect, test } from "bun:test";
import { listen } from "@nyte-ai/host";
import { sdk } from "@nyte-ai/sdk/client";
import { openTestHost } from "../fixture/host.ts";
import { followedSession } from "../../src/model/state.ts";
import { composerShows, shownAt, startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";
import { SAMPLE_ANSWER, saveFrame, saveProof } from "./scenario.ts";

const LONG_LINES = 3_000;

/** Sends `prompt`, answered with `answer`, and renders until `shows` is on screen and the run is idle. */
async function answered(tui: Tui, prompt: string, answer: string, shows: string): Promise<void> {
  tui.fixture.reply({ content: [{ type: "text", text: answer }] });
  await tui.send(prompt);
  await tui.frame((frame) => frame.includes(shows));
  await tui.state((store) => store.screen().run.kind === "idle");
  await tui.renderOnce();
}

test("empty: a new chat's welcome screen", async () => {
  await using tui = await startTui();
  await tui.ready();
  await tui.renderOnce();
  await saveFrame(tui, "state-empty");

  expect(tui.captureCharFrame()).toContain("❯ Plan, search, build anything");
});

test("loading: the composer takes typing while the host is still opening", async () => {
  await using tui = await startTui({ opened: false, typed: "draft while loading", record: true });
  await tui.frame((frame) => composerShows(frame, "draft while loading"));
  await saveFrame(tui, "state-loading");

  expect(tui.store.state().facts.host).not.toBe("open");
  expect(shownAt(tui, (frame) => frame.includes("❯ draft while loading"))).toBeLessThanOrEqual(50);
});

test("streaming: a reply mid-stream shows its text and the working row", async () => {
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
  await saveFrame(tui, "state-streaming");

  expect(tui.store.screen().run.kind).not.toBe("idle");
  held.resolve();
  await tui.state((store) => store.screen().run.kind === "idle");
});

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

  const steerPrompt = (): boolean =>
    tui.store
      .screen()
      .transcript.rows.some((row) => row.kind === "prompt" && row.message.content === steer);

  await tui.send(steer);
  await tui.until(() => {
    if (tui.store.screen().queue.some((row) => row.text === steer)) queued.push(steer);

    return (
      steerPrompt() &&
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
  expect(steerPrompt()).toBe(false);
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
  await using tui = await startTui({ host: connection, size: { width: 80, height: 24 } });
  await tui.ready();
  fixture.reply({ content: [{ type: "text", text: "first answer" }] });
  await tui.send("hello");
  await tui.frame((frame) => frame.includes("first answer"));
  await tui.state((store) => store.screen().run.kind === "idle");
  await first.close();

  await tui.send("are you there");
  await tui.frame((frame) => frame.includes("… are you there"));
  await saveFrame(tui, "state-offline");

  tui.store.dispatch({ kind: "remote", remote: { kind: "connecting" } });
  await tui.renderOnce();
  await saveFrame(tui, "state-reconnecting");

  await using second = await listen(fixture.host, {
    transport: { kind: "http", port: Number(new URL(url).port) },
    auth: { kind: "token", token },
  });

  fixture.reply({ content: [{ type: "text", text: "back again" }] });
  await tui.frame((frame) => frame.includes("back again"));
  tui.store.dispatch({ kind: "remote", remote: { kind: "shared", devices: 1 } });
  await tui.renderOnce();
  await saveFrame(tui, "state-reconnected");

  await saveProof("state-offline-gap", {
    step: "The service connection drops",
    shows:
      "The unsent message with a leading … and nothing else: no offline or reconnecting mark until it lands.",
    frame: "state-offline",
    verdict: "gap",
    why: "The footer's connection mark covers Nyte Connect sharing only (remote facts); the SDK's own reconnect to the service is not shown.",
  });

  await tui.dispose();
  await connection.close();
  expect(second.address).toBeDefined();
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

test("narrow: the same conversation at 60 columns", async () => {
  await using tui = await startTui({ size: { width: 60, height: 32 } });
  await tui.ready();
  await answered(tui, "show me the plan", SAMPLE_ANSWER, "another step");
  await saveFrame(tui, "state-narrow-60");

  expect(
    tui
      .captureCharFrame()
      .split("\n")
      .every((line) => line.length <= 60),
  ).toBe(true);
});

for (const theme of ["dark", "light"] as const)
  test(`${theme}: the same conversation in the ${theme} theme`, async () => {
    await using tui = await startTui();
    await tui.ready();
    await tui.send(`/theme ${theme}`);
    await tui.state((store) => store.state().facts.settings.theme === theme);
    await answered(tui, "show me the plan", SAMPLE_ANSWER, "another step");
    await saveFrame(tui, `state-${theme}`);
  });
