import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { testModel } from "@nyte-ai/host/bench";
import { exitText } from "../../src/app/main.tsx";
import { followedSession } from "../../src/model/state.ts";
import { openTestHost } from "../fixture/host.ts";
import { footerShows, shownAt, startTui } from "../harness/tui.ts";

const TURNS = 1_000;

test("/quit names the resume command; --session reopens the transcript, model and level, and the next request carries the history", async () => {
  await using fixture = await openTestHost({
    models: [testModel("model", { reasoning: true }), testModel("child", { reasoning: true })],
  });

  await using first = await startTui({ fixture });
  await first.ready();
  await first.send("/model child");
  await first.frame((frame) => footerShows(frame, "child", "minimal"));
  first.press("chat.thinking.cycle");
  await first.frame((frame) => footerShows(frame, "child", "low"));
  fixture.reply({ content: [{ type: "text", text: "Remember this answer." }] });
  await first.send("hi nyte");
  await first.frame((frame) => frame.includes("Remember this answer."));
  await first.state((store) => store.screen().run.kind === "idle");
  const session = followedSession(first.store.state())?.id;

  if (session === undefined) throw new Error("No session was followed.");
  await first.send("/quit");
  expect(await first.app.closing).toBe(0);
  expect(exitText({ session, unsent: null, failures: [], crashes: [] })).toBe(
    `\nTo resume previous session\nnyte --session=${session}\n`,
  );
  await first.dispose();

  await using resumed = await startTui({ fixture, target: { kind: "session", id: session } });
  await resumed.frame(
    (frame) => frame.includes("Remember this answer.") && footerShows(frame, "child", "low"),
  );
  fixture.reply({ content: [{ type: "text", text: "Still the child model." }] });
  await resumed.send("after the restart");
  await resumed.frame((frame) => frame.includes("Still the child model."));

  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[1]?.model.id).toBe("child");
  expect(fixture.requests[1]?.options?.reasoning).toBe("low");
  expect(JSON.stringify(fixture.requests[1]?.context.messages)).toContain("hi nyte");
});

test("a 2,000-message session's first screen paints within 100 ms of launch, and the same frame after quitting and resuming again", async () => {
  await using fixture = await openTestHost();
  fixture.reply({ content: [{ type: "text", text: "answer 0" }] });
  const { session, receipt } = await fixture.host.sessions.start({ content: "question 0" });
  await receipt.settled();
  const { id } = session;

  for (let turn = 1; turn < TURNS; turn++) {
    fixture.reply({ content: [{ type: "text", text: `answer ${String(turn)}` }] });
    await (await fixture.host.session(id).send(`question ${String(turn)}`)).settled();
  }

  const last = `answer ${String(TURNS - 1)}`;
  const cwd = mkdtempSync(join(tmpdir(), "nyte-tui-resume-"));
  const local = { cwd };

  await using tui = await startTui({
    fixture,
    target: { kind: "session", id },
    record: true,
    local,
  });

  await tui.frame((frame) => frame.includes(last));

  expect(shownAt(tui, (frame) => frame.includes(last))).toBeLessThanOrEqual(100);
  await tui.state((store) => store.screen().blocked === null);
  await tui.renderOnce();
  const before = tui.captureCharFrame();
  const beforeSpans = tui.captureSpans();
  await tui.send("/quit");
  expect(await tui.app.closing).toBe(0);
  await tui.dispose();

  await using resumed = await startTui({
    fixture,
    target: { kind: "session", id },
    record: true,
    local,
  });

  await resumed.frame((frame) => frame.includes(last));

  expect(shownAt(resumed, (frame) => frame.includes(last))).toBeLessThanOrEqual(100);
  await resumed.state((store) => store.screen().blocked === null);
  await resumed.renderOnce();
  expect(resumed.captureCharFrame()).toBe(before);
  expect(resumed.captureSpans()).toEqual(beforeSpans);
  rmSync(cwd, { recursive: true, force: true });
}, 30_000);

test("--resume opens the newest chat; /new opens a blank chat that only its first send starts", async () => {
  await using fixture = await openTestHost();

  for (const text of ["older", "newer"]) {
    fixture.reply({ content: [{ type: "text", text: `answer ${text}` }] });
    await (await fixture.host.sessions.start({ content: text })).receipt.settled();
  }

  const listed = async () =>
    (await fixture.host.sessions.list({ parents: { kind: "roots" } })).items.map((info) => info.id);

  const [newest] = await listed();

  await using tui = await startTui({ fixture, target: { kind: "latest" } });
  await tui.frame((frame) => frame.includes("answer newer"));
  expect(followedSession(tui.store.state())?.id).toBe(newest);

  await tui.send("/new");
  await tui.state((store) => store.state().facts.chat?.kind === "blank");
  expect(await listed()).toHaveLength(2);

  fixture.reply({ content: [{ type: "text", text: "answer newest" }] });
  await tui.send("newest");
  await tui.frame((frame) => frame.includes("answer newest"));
  const started = followedSession(tui.store.state())?.id;

  expect(await listed()).toEqual([started, newest, expect.anything()]);
});
