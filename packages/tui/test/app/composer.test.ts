import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { COMPOSER_PLACEHOLDER } from "../../src/lib/constants.ts";
import { resolveMention } from "../../src/effects/local-ports.ts";
import { openTestHost, testEnvironment } from "../fixture/host.ts";
import { composerShows, cursorCell, startTui } from "../harness/tui.ts";

const FRAME_MS = 1000 / 60;

const lineStartDeleted = (frame: string): boolean =>
  composerShows(frame, "kept 前") &&
  frame.split("\n").some((line) => /^\s*│\s+tail\s+│\s*$/u.test(line)) &&
  !frame.includes("delete me");

test("each typed key shows in the composer within a frame at p95 and 50 ms at worst", async () => {
  await using tui = await startTui();
  await tui.ready();
  const keys = [...new Intl.Segmenter().segment("hi nyte, every key shows at once")];
  const latencies: number[] = [];

  for (const { segment, index } of keys) {
    const typed = performance.now();
    tui.mockInput.pressKey(segment);
    await tui.frame((frame) =>
      composerShows(
        frame,
        keys
          .slice(0, index + 1)
          .map((key) => key.segment)
          .join(""),
      ),
    );
    latencies.push(performance.now() - typed);
  }

  const sorted = latencies.toSorted((left, right) => left - right);

  expect(sorted[Math.floor(sorted.length * 0.95)]).toBeLessThanOrEqual(FRAME_MS);
  expect(sorted.at(-1)).toBeLessThanOrEqual(50);
});

test("Cmd+Backspace deletes to the line start, undo restores it, and the other deletion keys still work", async () => {
  await using tui = await startTui();
  await tui.ready();

  await tui.mockInput.pasteBracketedText("kept 前\ndelete me tail");
  await tui.frame((frame) => composerShows(frame, "kept 前") && frame.includes("delete me tail"));

  for (let step = 0; step < 4; step++) tui.mockInput.pressArrow("left");

  tui.press("composer.delete.to.line.start");
  await tui.frame(lineStartDeleted);
  tui.mockInput.pressKey("z", { super: true });
  await tui.frame((frame) => frame.includes("delete me tail"));
  tui.mockInput.pressKey("u", { ctrl: true });
  await tui.frame(lineStartDeleted);
  tui.press("chat.quit");
  await tui.frame((frame) => composerShows(frame, COMPOSER_PLACEHOLDER));

  await tui.mockInput.typeText("word remove");
  tui.mockInput.pressBackspace({ meta: true });
  await tui.frame((frame) => composerShows(frame, "word ") && !frame.includes("remove"));
  tui.mockInput.pressBackspace();
  await tui.state((store) => store.state().local.draft.text === "word");
});

test("resizing narrow and back keeps the draft, the cursor at its end and one composer", async () => {
  await using tui = await startTui();
  await tui.ready();
  const draft = "resize keeps this";
  await tui.mockInput.typeText(draft);

  for (const [width, height] of [
    [64, 20],
    [100, 32],
  ] as const) {
    tui.resize(width, height);

    const frame = await tui.frame(
      (shown) => shown.split("\n")[0]?.length === width && composerShows(shown, draft),
    );

    const lines = frame.split("\n");
    const row = lines.findIndex((line) => line.includes(`❯ ${draft}`));

    expect(lines.filter((line) => line.trimStart().startsWith("╰─"))).toHaveLength(1);
    const before = (lines[row] ?? "").split(draft)[0] ?? "";

    expect(cursorCell(tui)).toEqual([before.length + draft.length, row]);
  }
});

test("keys typed while the host opens stay in the composer through boot", async () => {
  await using tui = await startTui({ opened: false });

  await tui.mockInput.typeText("typed while starting");
  await tui.frame((frame) => composerShows(frame, "typed while starting"));

  tui.openHost();
  await tui.ready();
  expect(tui.store.state().local.draft.text).toBe("typed while starting");
});

test("an @./ path is offered as its file, and the file's text rides with the message", async () => {
  await using fixture = await openTestHost({ environment: testEnvironment(refuseExec) });
  await using tui = await startTui({ fixture });
  await tui.ready();
  await mkdir(join(tui.home, "notes"), { recursive: true });
  await writeFile(join(tui.home, "notes", "mention.md"), "Mention body\n");
  tui.files.resolveMention = resolveMention;

  await tui.mockInput.typeText("@./notes/mention.md");
  await tui.frame((frame) =>
    frame
      .split("\n")
      .some((line) => line.includes("❯ mention.md") && line.includes("notes/mention.md")),
  );
  tui.press("completion.accept");
  await tui.frame((frame) => composerShows(frame, "[File mention.md] "));
  fixture.reply({ content: [{ type: "text", text: "The note arrived." }] });
  await tui.send("summarize the note");
  await tui.frame((frame) => frame.includes("The note arrived."));

  expect(JSON.stringify(fixture.requests[0]?.context.messages)).toContain(
    JSON.stringify(`${join("notes", "mention.md")}">\nMention body\n\n</file>`).slice(1, -1),
  );
});

async function refuseExec(): Promise<never> {
  throw new Error("No processes in this test.");
}
