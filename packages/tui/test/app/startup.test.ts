import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";
import { expect, test } from "bun:test";
import { lastUserText } from "@nyte-ai/bench";
import type { Selection } from "../../src/model/state.ts";
import { rootSessions } from "../../src/run.ts";
import { FileSettingsStore } from "../../src/services/settings.ts";
import { composerShows, cursorCell, footerShows, shownAt, startTui } from "../harness/tui.ts";

const CURRENT: Selection = { model: { provider: "test", id: "model" }, effort: "off", fast: false };

function layoutRows(tui: Pick<TestRendererSetup, "captureSpans">): readonly number[] {
  const rows = tui.captureSpans().lines.map((line) => line.spans.map((span) => span.text).join(""));

  return ["Welcome to Nyte", "│ ❯ ", "╰─ "].map((text) =>
    rows.findIndex((row) => row.includes(text)),
  );
}

test("the host's model appears in the footer in place once the host opens", async () => {
  await using tui = await startTui({ opened: false, typed: "typed at launch" });

  await tui.frame((shown) => composerShows(shown, "typed at launch"));
  const before = layoutRows(tui);
  const cursor = cursorCell(tui);
  tui.openHost();
  await tui.frame(
    (shown) => composerShows(shown, "typed at launch") && footerShows(shown, "model", "off"),
  );

  expect(before.every((row) => row >= 0)).toBe(true);
  expect(layoutRows(tui)).toEqual(before);
  expect(cursorCell(tui)).toEqual(cursor);
  expect(tui.store.state().facts.chat?.selection).toEqual(CURRENT);
});

test("Enter before the host opens keeps the message on screen and starts the chat once it does", async () => {
  await using tui = await startTui({ opened: false });

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
  await using tui = await startTui({ opened: false });

  await tui.send("never mind");
  await tui.frame((frame) => frame.includes("sends when Nyte connects"));
  tui.press("chat.interrupt");
  await tui.frame((frame) => composerShows(frame, "never mind"));

  tui.openHost();
  await tui.ready();
  expect(await Array.fromAsync(rootSessions(tui.fixture.host))).toHaveLength(0);
});

test("a launch paints the composer and keys typed at launch within 50 ms while the host opens, takes Enter, shows every waiting message, and starts on the host's default", async () => {
  await using tui = await startTui({ opened: false, typed: "typed at launch", record: true });

  const painted = await tui.frame((shown) => shown.includes("❯ typed at launch"));
  expect(shownAt(tui, (shown) => shown.includes("❯ typed at launch"))).toBeLessThanOrEqual(50);
  expect(tui.store.screen().blocked).toBeNull();
  expect(painted).toContain("for files");
  expect(painted).toContain("enter send");
  expect(tui.store.state().facts.host).toBe("opening");

  tui.mockInput.pressEnter();
  await tui.send("and a follow-up");
  await tui.frame(
    (frame) =>
      frame.includes("typed at launch") &&
      frame.includes("and a follow-up") &&
      frame.split("sends when Nyte connects").length === 3,
  );

  tui.openHost();
  await tui.state((store) => store.state().facts.chat?.kind === "session");
  expect(await Array.fromAsync(rootSessions(tui.fixture.host))).toHaveLength(1);
  expect(lastUserText(await tui.fixture.requested(1))).toBe("typed at launch");
  expect(tui.store.state().facts.chat?.selection).toEqual(CURRENT);
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
      settings: {
        read: () => store.read(root),
        write: async () => store.read(root).settings,
        settled: () => store.settled(),
      },
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
