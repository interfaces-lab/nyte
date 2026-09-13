import assert from "node:assert/strict";
import {
  composer,
  deadline,
  output,
  press,
  quit,
  ready,
  resumeSession,
  session,
  type,
} from "./drive.ts";
import { queueFollowUps } from "./queue.ts";
import { steerHandoff } from "./steer-handoff.ts";
import type { Scenario } from "./types.ts";

/** Boundaries a journey cannot host: the CLI itself and OS signals. */
export const cases: Scenario[] = [
  steerHandoff,
  queueFollowUps,
  {
    name: "launch.help",
    covers: ["CLI boundaries", "compiled binary startup"],
    async run(context) {
      const terminal = await context.open({ args: ["--help"] });
      assert.equal(await terminal.waitForExit(deadline()), 0);
      await terminal.waitForScreen((screen) => screen.text.includes("--session"), deadline());
      assert.match(output(terminal), /--session/u);
    },
  },
  {
    name: "rendering.resize-and-focus",
    covers: [
      "terminal resize rendering",
      "repeated resize",
      "focus input restoration",
      "draft preservation",
    ],
    run: (context) =>
      session(context, {}, async ({ terminal }) => {
        await terminal.waitForScreen(ready, deadline());
        let draft = "keep this draft";
        await type(terminal, draft);
        for (let cycle = 0; cycle < 3; cycle++) {
          for (const { width, height } of [
            { width: 60, height: 12 },
            { width: 140, height: 36 },
            { width: 100, height: 32 },
          ]) {
            const input = terminal.resize(width, height);
            const shown = await terminal.waitForScreen(
              (screen) =>
                screen.columns === width &&
                screen.rows === height &&
                composer(screen, draft) &&
                screen.lines.some(
                  (line) => line.includes(draft) && line.lastIndexOf("│") === width - 2,
                ) &&
                ready(screen),
              deadline(),
              input,
            );
            const footers = shown.lines.filter((line) => line.includes("╰"));
            assert.equal(footers.length, 1, "Only one composer footer remains after resize");
            const composerRow = shown.lines.findIndex((line) => line.includes(`❯ ${draft}`));
            const composerLine = shown.lines[composerRow];
            if (composerLine === undefined) throw new Error("The composer row is missing");
            assert.equal(shown.lines[composerRow + 1], footers[0]);
            assert.equal(shown.cursor.x, composerLine.indexOf(draft) + draft.length);
            assert.equal(shown.cursor.y, composerRow);
            assert.equal(shown.cursor.visible, true);
            assert.ok(
              shown.lines
                .slice(composerRow + 2)
                .join(" ")
                .includes("enter send"),
            );
          }
          terminal.raw("\x1b[O\x1b[I", "terminal.blur-focus");
          await type(terminal, ".", { prefix: draft });
          draft += ".";
        }
        await press(terminal, "chat.quit", (screen) => !screen.text.includes(draft));
        await quit(terminal);
      }),
  },
  {
    name: "rendering.history-stream-and-popups",
    covers: [
      "Long streaming history",
      "reading-away anchor",
      "fixed wheel speed",
      "page scrolling",
      "disjoint notice and picker layout",
      "return to latest",
      "composer history keys",
      "resize and focus input restoration",
      "draft and cursor preservation",
    ],
    run: (context) => {
      const history = Array.from(
        { length: 180 },
        (_, index) => `history-row-${String(index).padStart(3, "0")} stable`,
      ).join("\n");
      const streamTail = `\n${Array.from(
        { length: 100 },
        (_, index) => `stream-row-${String(index).padStart(3, "0")}`,
      ).join("\n")}\nSTREAM-END-UNIQUE`;
      return session(
        context,
        {
          height: 24,
          steps: [
            {
              name: "long history",
              prompt: "build long history",
              action: { kind: "reply", text: history },
            },
            {
              name: "growing stream",
              prompt: "grow while reading",
              action: { kind: "hold", text: "STREAM-BEGIN-UNIQUE" },
            },
          ],
        },
        async ({ terminal, provider }) => {
          await terminal.waitForScreen(ready, deadline());
          await type(terminal, "build long history");
          await press(
            terminal,
            "chat.submit",
            (screen) => screen.text.includes("history-row-179 stable") && ready(screen),
          );
          await type(terminal, "grow while reading");
          await press(terminal, "chat.submit", (screen) =>
            screen.text.includes("STREAM-BEGIN-UNIQUE"),
          );
          const streaming = await provider.waitForRequest(
            (request) => request.script === "growing stream",
          );
          await provider.waitForStage(streaming.id, "held");

          for (let pages = 0; !terminal.screen().text.includes("history-row-100 stable"); pages++) {
            assert.ok(pages < 20, "The named history row is reachable by page scrolling");
            const before = terminal.screen().text;
            await press(
              terminal,
              "chat.scroll.page.up",
              (screen) => screen.text !== before && screen.text.includes("ctrl+end latest"),
            );
          }
          const beforeWheel = terminal.screen();
          const firstBeforeWheel = beforeWheel.lines
            .map((line) => /history-row-(\d{3}) stable/u.exec(line)?.[1])
            .find((value) => value !== undefined);
          assert.ok(firstBeforeWheel, "A complete history row is visible before wheel input");
          const wheel = terminal.mouse({
            type: "scroll",
            button: 4,
            x: 10,
            y: 5,
            modifiers: { shift: false, alt: false, ctrl: false },
            scroll: { direction: "up", delta: 1 },
          });
          const afterWheel = await terminal.waitForScreen(
            (screen) =>
              screen.text !== beforeWheel.text &&
              screen.text.includes("ctrl+end latest") &&
              screen.text.includes("history-row-"),
            deadline(),
            wheel,
          );
          const firstAfterWheel = afterWheel.lines
            .map((line) => /history-row-(\d{3}) stable/u.exec(line)?.[1])
            .find((value) => value !== undefined);
          assert.ok(firstAfterWheel, "Wheel input leaves historical rows visible");
          assert.equal(
            Number(firstBeforeWheel) - Number(firstAfterWheel),
            3,
            "One wheel-up event moves exactly three rows",
          );
          const draft = "draft-cursor-unique";
          await type(terminal, draft);
          const beforeGrowth = terminal.screen();
          const composerRow = beforeGrowth.lines.findIndex((line) => line.includes("│ ❯"));
          const anchor = beforeGrowth.lines
            .map((line, row) => ({ line, row, text: /history-row-\d{3} stable/u.exec(line)?.[0] }))
            .find(
              (candidate) =>
                candidate.text !== undefined && candidate.row >= 1 && candidate.row < composerRow,
            );
          assert.ok(anchor?.text, "A complete history row remains after wheel input");
          const anchoredRow = anchor.row;
          const cursorBeforeGrowth = terminal.cursor();
          provider.release(streaming.id, streamTail);
          await provider.waitForStage(streaming.id, "completed");
          const grown = await terminal.waitForScreen(
            (screen) =>
              (screen.lines[anchoredRow]?.includes(anchor.text ?? "") ?? false) &&
              composer(screen, draft) &&
              ready(screen),
            deadline(),
          );
          assert.ok(!grown.text.includes("STREAM-END-UNIQUE"), "Streaming stays below the reader");
          assert.equal(grown.cursor.x, cursorBeforeGrowth.x);
          assert.equal(grown.cursor.y, cursorBeforeGrowth.y);
          assert.equal(
            grown.lines.filter((line) => line.includes("╰") && line.includes("nyte-qa")).length,
            1,
            "One footer remains while output grows",
          );

          for (const width of [72, 110, 84]) {
            const resize = terminal.resize(width, 24);
            const resized = await terminal.waitForScreen(
              (screen) =>
                screen.columns === width &&
                screen.rows === 24 &&
                (screen.lines[anchoredRow]?.includes(anchor.text ?? "") ?? false) &&
                composer(screen, draft) &&
                ready(screen),
              deadline(),
              resize,
            );
            assert.equal(
              resized.lines.filter((line) => line.includes("╰") && line.includes("nyte-qa")).length,
              1,
              "One footer remains after history reflow",
            );
          }
          terminal.raw("\x1b[O\x1b[I", "terminal.blur-focus.history");
          await type(terminal, ".", { prefix: draft });
          assert.equal(terminal.screen().lines[anchoredRow]?.includes(anchor.text), true);

          await press(terminal, "chat.quit", (screen) => !screen.text.includes(`${draft}.`));
          await type(terminal, "/");
          await terminal.waitForScreen(
            (screen) =>
              screen.text.includes("/auto-update") &&
              screen.text.includes("enter accept") &&
              screen.lines.filter((line) => line.includes("╰") && line.includes("nyte-qa"))
                .length === 1 &&
              (screen.lines[anchoredRow]?.includes(anchor.text ?? "") ?? false),
            deadline(),
          );
          await press(
            terminal,
            "completion.close",
            (screen) =>
              !screen.text.includes("/auto-update") &&
              composer(screen, "/") &&
              ready(screen) &&
              (screen.lines[anchoredRow]?.includes(anchor.text ?? "") ?? false),
          );
          await press(
            terminal,
            "chat.quit",
            (screen) => composer(screen, "Plan, search, build anything") && ready(screen),
          );
          await type(terminal, "/settings");
          const settings = await press(
            terminal,
            "chat.submit",
            (screen) =>
              screen.text.includes("Settings") &&
              screen.text.includes("Scroll acceleration") &&
              screen.text.includes("enter open") &&
              screen.lines.filter((line) => line.includes("╰") && line.includes("nyte-qa"))
                .length === 1 &&
              (screen.lines[anchoredRow]?.includes(anchor.text ?? "") ?? false),
          );
          assert.match(settings.text, /Scroll acceleration\s+off/iu);
          await press(
            terminal,
            "picker.close",
            (screen) =>
              !screen.text.includes("Scroll acceleration") &&
              composer(screen, "Plan, search, build anything") &&
              ready(screen) &&
              (screen.lines[anchoredRow]?.includes(anchor.text ?? "") ?? false),
          );
          await type(terminal, "/theme dark");
          await press(
            terminal,
            "chat.submit",
            (screen) =>
              screen.text.includes("Theme: dark") &&
              (screen.lines[anchoredRow]?.includes(anchor.text ?? "") ?? false),
          );
          await type(terminal, "x");
          assert.equal(terminal.screen().lines[anchoredRow]?.includes(anchor.text), true);
          await press(terminal, "chat.quit", (screen) =>
            composer(screen, "Plan, search, build anything"),
          );

          const latest = await press(
            terminal,
            "chat.scroll.latest",
            (screen) =>
              screen.text.includes("STREAM-END-UNIQUE") &&
              !screen.text.includes("ctrl+end latest") &&
              composer(screen, "Plan, search, build anything"),
          );
          const newest = latest.lines.findIndex((line) => line.includes("STREAM-END-UNIQUE"));
          const latestComposer = latest.lines.findIndex((line) => line.includes("│ ❯"));
          assert.ok(newest >= 0 && newest < latestComposer, "Newest output is above the composer");
          assert.equal(
            latest.lines.filter((line) => line.includes("╰") && line.includes("nyte-qa")).length,
            1,
          );
          await press(
            terminal,
            "chat.history.previous",
            (screen) =>
              composer(screen, "grow while reading") && screen.text.includes("STREAM-END-UNIQUE"),
          );
          const historyEnd = terminal.key("chat.history.next");
          await terminal.waitForScreen(
            (screen) =>
              composer(screen, "grow while reading") &&
              screen.cursor.x > historyEnd.before.cursor.x,
            deadline(),
            historyEnd,
          );
          await press(
            terminal,
            "chat.history.next",
            (screen) =>
              composer(screen, "Plan, search, build anything") &&
              screen.text.includes("STREAM-END-UNIQUE"),
          );
          await quit(terminal);
        },
      );
    },
  },
  {
    name: "exit.signals.two-lines",
    covers: ["Terminal lifecycle and integrations", "copyable resume", "SIGINT", "SIGTERM"],
    run: (context) =>
      session(context, {}, async ({ terminal, reopen }) => {
        await terminal.waitForScreen(ready, deadline());
        terminal.signal("SIGINT");
        await resumeSession(terminal, 130);
        const second = await reopen();
        await second.waitForScreen(ready, deadline());
        second.signal("SIGTERM");
        await resumeSession(second, 143);
      }),
  },
];
