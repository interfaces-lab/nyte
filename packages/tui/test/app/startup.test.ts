import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";
import { expect, test } from "bun:test";
import { lastUserText } from "@nyte-ai/host/bench";
import type { Selection } from "../../src/model/state.ts";
import { rootSessions } from "../../src/run.ts";
import { FileSettingsStore } from "../../src/services/settings.ts";
import { composerShows, cursorCell, footerShows, shownAt, startTui } from "../harness/tui.ts";

const RECORDED: Selection = {
  model: { provider: "test", id: "older" },
  effort: "off",
  fast: false,
};

const CURRENT: Selection = { model: { provider: "test", id: "model" }, effort: "off", fast: false };

/** Where the welcome title, the composer's input row and its bottom border sit, from the drawn spans. */
function layoutRows(tui: Pick<TestRendererSetup, "captureSpans">): readonly number[] {
  const rows = tui.captureSpans().lines.map((line) => line.spans.map((span) => span.text).join(""));

  return ["Welcome to Nyte", "│ ❯ ", "╰─ "].map((text) =>
    rows.findIndex((row) => row.includes(text)),
  );
}

const launched = (frame: string, model: string): boolean =>
  composerShows(frame, "typed at launch") && footerShows(frame, model, "off");

test("a launch paints the composer, the recorded model and keys typed at launch within 50 ms, while the host never opens", async () => {
  await using tui = await startTui({
    opened: false,
    typed: "typed at launch",
    record: true,
    firstFrame: RECORDED,
  });

  const frame = await tui.frame((shown) => launched(shown, "older"));

  expect(shownAt(tui, (shown) => launched(shown, "older"))).toBeLessThanOrEqual(50);
  expect(tui.store.screen().blocked).toBeNull();
  expect(frame).toContain("for files");
  expect(frame).toContain("enter send");
  expect(tui.store.state().facts.host).toBe("opening");
});

test("the catalog's model replaces the recorded one in place once the host opens", async () => {
  await using tui = await startTui({
    opened: false,
    typed: "typed at launch",
    firstFrame: RECORDED,
  });

  await tui.frame((shown) => launched(shown, "older"));
  const before = layoutRows(tui);
  const cursor = cursorCell(tui);
  tui.openHost();
  await tui.frame((shown) => launched(shown, "model"));

  expect(before.every((row) => row >= 0)).toBe(true);
  expect(layoutRows(tui)).toEqual(before);
  expect(cursorCell(tui)).toEqual(cursor);
  expect(tui.store.state().facts.chat?.selection).toEqual(CURRENT);
});

test("Enter before the host opens keeps the message on screen and starts the chat once it does", async () => {
  await using tui = await startTui({ opened: false, firstFrame: CURRENT });

  await tui.send("first words");
  await tui.frame(
    (frame) => frame.includes("first words") && frame.includes("sends when Nyte connects"),
  );
  tui.mockInput.pressEnter();
  await tui.renderOnce();
  expect(tui.store.state().local.notice).toBeNull();

  tui.openHost();
  await tui.frame((frame) => frame.includes("first words") && !frame.includes("sends when Nyte"));
  await tui.state((store) => store.state().facts.chat?.kind === "session");
  const sessions = await Array.fromAsync(rootSessions(tui.fixture.host));

  expect(sessions).toHaveLength(1);
  expect(lastUserText(await tui.fixture.requested(1))).toBe("first words");
  expect(tui.fixture.requests).toHaveLength(1);
});

test("Esc recalls a message waiting for the host into the composer, and nothing starts", async () => {
  await using tui = await startTui({ opened: false, firstFrame: CURRENT });

  await tui.send("never mind");
  await tui.frame((frame) => frame.includes("sends when Nyte connects"));
  tui.press("chat.interrupt");
  await tui.frame((frame) => composerShows(frame, "never mind"));

  tui.openHost();
  await tui.ready();
  expect(await Array.fromAsync(rootSessions(tui.fixture.host))).toHaveLength(0);
});

test("a recorded model the host no longer lists hands the message back and names the fix", async () => {
  await using tui = await startTui({ opened: false, firstFrame: RECORDED });

  await tui.send("hello there");
  tui.openHost();
  await tui.frame((frame) => composerShows(frame, "hello there"));

  expect(tui.store.state().local.notice?.text).toBe("older isn't available. ctrl+p picks another.");
  expect(await Array.fromAsync(rootSessions(tui.fixture.host))).toHaveLength(0);
});

test("without a recorded model the first frame takes keys, and the chat opens with the host", async () => {
  await using tui = await startTui({ opened: false, typed: "typed at launch", record: true });

  await tui.frame((frame) => frame.includes("❯ typed at launch"));
  expect(shownAt(tui, (frame) => frame.includes("❯ typed at launch"))).toBeLessThanOrEqual(50);
  expect(tui.store.screen().blocked).toEqual({ kind: "no-session" });

  tui.openHost();
  await tui.ready();
  expect(tui.store.state().local.draft.text).toBe("typed at launch");
  expect(tui.fixture.requests).toHaveLength(0);
});

test("a settings file that doesn't parse is left out of the first frame's settings, and a notice names it", async () => {
  const root = mkdtempSync(join(tmpdir(), "nyte-settings-"));
  const global = join(root, "settings.json");
  mkdirSync(join(root, ".nyte"));
  writeFileSync(global, '{ "theme": "light", "followUp": "sideways" }\n');
  writeFileSync(join(root, ".nyte", "settings.json"), '{ "copyOnSelect": true }\n');
  const store = new FileSettingsStore(global);

  try {
    await using tui = await startTui({
      opened: false,
      settings: { read: () => store.read(root), write: async () => store.read(root).settings },
    });

    await tui.frame((frame) => frame.includes("Ignored"));
    expect(tui.store.state().facts.settings).toMatchObject({ theme: "auto", copyOnSelect: true });
    expect(tui.store.state().local.notice?.text).toBe(
      `Ignored ${global}: settings.followUp must be steer or queue`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
