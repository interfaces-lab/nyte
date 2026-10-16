import { expect, test } from "bun:test";
import { COMPOSER_PLACEHOLDER } from "../../src/lib/constants.ts";
import { belowComposer, composerShows, startTui } from "../harness/tui.ts";
import type { Tui } from "../harness/tui.ts";

async function answered(tui: Tui, text: string): Promise<void> {
  tui.fixture.reply({ content: [{ type: "text", text }] });
  await tui.send("hi nyte");
  await tui.frame((frame) => frame.includes(text));
  await tui.state((store) => store.screen().run.kind === "idle");
}

test("/usage opens under the composer: nothing before a reply, the reply's tokens after; Ctrl+C closes it", async () => {
  await using tui = await startTui();
  await tui.ready();

  await tui.send("/usage");
  await tui.frame((frame) => belowComposer(frame, "Usage") && frame.includes("No usage recorded"));
  tui.press("picker.close");
  await tui.frame((frame) => !belowComposer(frame, "Usage"));

  await answered(tui, "Hello from the fake provider.");
  await tui.send("/usage");
  const shown = await tui.frame((frame) => belowComposer(frame, "this chat · 15 tokens"));

  expect(shown).toContain("input 10 · output 5");
  expect(shown).toContain("Hello from the fake provider.");
  tui.press("chat.quit");
  await tui.frame(
    (frame) => !belowComposer(frame, "Usage") && composerShows(frame, COMPOSER_PLACEHOLDER),
  );
  expect(tui.fixture.requests).toHaveLength(1);
});

test("every slash menu opens under the composer and closes without sending", async () => {
  await using tui = await startTui();
  await tui.ready();
  await answered(tui, "Hello from the fake provider.");

  for (const [name, title] of [
    ["help", "Commands"],
    ["settings", "Settings"],
    ["model", "Models"],
    ["theme", "Theme"],
    ["follow-up", "Follow-up behavior"],
    ["resume", "Resume chat"],
    ["tasks", "Tasks"],
    ["tree", "Session Tree"],
    ["edit", "Session Tree"],
    ["plugins", "Plugins"],
    ["accounts", "Accounts"],
    ["login", "Sign in to a provider"],
    ["logout", "Remove a stored credential"],
  ] as const) {
    await tui.send(`/${name}`);

    const shown = await tui.frame(
      (frame) => belowComposer(frame, title) && composerShows(frame, COMPOSER_PLACEHOLDER),
    );

    expect(shown).toContain("Hello from the fake provider.");
    tui.press("picker.close");
    await tui.frame((frame) => !belowComposer(frame, title));
  }

  await tui.send("/help");
  await tui.frame((frame) => belowComposer(frame, "Commands"));
  tui.press("picker.accept");
  await tui.frame(
    (frame) => belowComposer(frame, "Keyboard shortcuts") && !belowComposer(frame, "Commands"),
  );
  tui.press("picker.close");
  await tui.frame((frame) => !belowComposer(frame, "Keyboard shortcuts"));
  expect(tui.fixture.requests).toHaveLength(1);
  expect(tui.store.screen().run.kind).toBe("idle");
});

test("settings lists the thinking level and Esc closes it", async () => {
  await using tui = await startTui();
  await tui.ready();

  await tui.send("/settings");
  await tui.frame(
    (frame) =>
      belowComposer(frame, "Settings") &&
      frame.split("\n").some((line) => /thinking level/iu.test(line)),
  );
  tui.press("picker.close");
  await tui.frame(
    (frame) => !belowComposer(frame, "Settings") && composerShows(frame, COMPOSER_PLACEHOLDER),
  );
});

test("/tree opens under the composer, Enter on the latest message says it is already there, Esc closes it", async () => {
  await using tui = await startTui();
  await tui.ready();
  await answered(tui, "Hello from the fake provider.");

  await tui.send("/tree");
  await tui.frame((frame) => belowComposer(frame, "Session Tree"));
  tui.press("picker.accept");
  await tui.frame((frame) => belowComposer(frame, "Already at that point in the chat"));
  tui.press("tree.close");
  await tui.frame(
    (frame) => !frame.includes("Session Tree") && composerShows(frame, COMPOSER_PLACEHOLDER),
  );
});
