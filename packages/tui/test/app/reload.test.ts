import process from "node:process";
import { expect, test } from "bun:test";
import { composerShows, startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";

function holds(tui: Tui) {
  const { renderer } = tui;

  return {
    renderer: renderer.eventNames().reduce((sum, name) => sum + renderer.listenerCount(name), 0),
    keys: renderer.keyInput.listenerCount("keypress") + renderer.keyInput.listenerCount("paste"),
    stdin: renderer.stdin
      .eventNames()
      .reduce((sum, name) => sum + renderer.stdin.listenerCount(name), 0),
    process: ["SIGINT", "SIGTERM", "SIGHUP", "uncaughtException", "unhandledRejection"].reduce(
      (sum, name) => sum + process.listenerCount(name),
      0,
    ),
    children: renderer.root.getChildrenCount(),
    renderables: [...renderer.nativeScene.getRenderables()].length,
  };
}

test("remounting leaves what the renderer, stdin and the process hold where one mount left it", async () => {
  await using tui = await startTui();
  await tui.ready();
  await tui.remount();
  await tui.ready();
  await tui.renderOnce();
  const once = holds(tui);

  for (let round = 0; round < 10; round++) {
    await tui.remount();
    await tui.ready();
  }

  await tui.renderOnce();
  expect(holds(tui)).toEqual(once);
});

test("a remount follows the same chat and keeps the typed draft", async () => {
  await using tui = await startTui();
  await tui.ready();
  tui.fixture.reply({ content: [{ type: "text", text: "First answer lands." }] });
  await tui.send("first question");
  await tui.frame((frame) => frame.includes("First answer lands."));
  await tui.state((store) => store.screen().run.kind === "idle");
  await tui.mockInput.typeText("half typed");
  const followed = tui.app.carry().session;

  await tui.remount();
  await tui.ready();

  const frame = await tui.frame(
    (shown) => shown.includes("First answer lands.") && composerShows(shown, "half typed"),
  );

  expect(frame).toContain("first question");
  expect(tui.app.carry()).toEqual({ session: followed, draft: "half typed" });
});

test("a run keeps streaming across a remount and finishes once", async () => {
  await using tui = await startTui();
  await tui.ready();
  const release = Promise.withResolvers<void>();

  tui.fixture.reply({
    content: [{ type: "text", text: "Streaming before the remount and after it." }],
    tokens: 2,
    tap: (streamed) => (streamed === 1 ? release.promise : undefined),
  });
  await tui.send("keep going");
  await tui.frame((frame) => frame.includes("Streaming before"));

  await tui.remount();
  release.resolve();

  await tui.frame((frame) => frame.includes("and after it."));
  await tui.state((store) => store.screen().run.kind === "idle");
  expect(tui.fixture.requests).toHaveLength(1);
});
