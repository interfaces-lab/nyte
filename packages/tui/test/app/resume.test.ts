import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { testModel } from "@nyte-ai/host/bench";
import { exitText } from "../../src/app/main.tsx";
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
  const session = first.store.state().facts.session?.id;

  if (session === undefined) throw new Error("No session was followed.");
  await first.send("/quit");
  expect(await first.app.closing).toBe(0);
  expect(exitText({ session, failures: [], crashes: [] })).toBe(
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

test("a 2,000-message session's first screen paints within 100 ms of mount, and the same frame after quitting and resuming again", async () => {
  await using fixture = await openTestHost();
  const { id } = await fixture.host.sessions.create({});

  for (let turn = 0; turn < TURNS; turn++) {
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

  expect(shownAt(tui, last)).toBeLessThanOrEqual(100);
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

  expect(shownAt(resumed, last)).toBeLessThanOrEqual(100);
  await resumed.state((store) => store.screen().blocked === null);
  await resumed.renderOnce();
  expect(resumed.captureCharFrame()).toBe(before);
  expect(resumed.captureSpans()).toEqual(beforeSpans);
  rmSync(cwd, { recursive: true, force: true });
}, 30_000);
