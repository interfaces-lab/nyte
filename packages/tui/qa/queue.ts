import assert from "node:assert/strict";
import { beat, composer, deadline, press, quit, ready, session, type } from "./drive.ts";
import type { Scenario, Screen } from "./types.ts";

/** The compact gutter row for a queued follow-up: the queue glyph and the message on one line. */
const gutterRow = (screen: Screen, text: string) =>
  screen.lines.findIndex((line) => line.includes(`↓ ${text}`));

/** The composer is painted and the run is still live. */
const busy = (screen: Screen) =>
  screen.text.includes("nyte-qa") &&
  screen.text.includes("enter steer") &&
  screen.text.includes("╰");

const cursorRow = (screen: Screen) =>
  screen.lines.findIndex((line) => line.trimStart().startsWith("❯ ") && !line.includes("│ ❯"));

/**
 * Ctrl+Enter follow-ups keep their compact rows below the transcript: one row
 * each, capped to the terminal's share with the rest counted, editable,
 * reorderable and removable from the queue, and delivered in the queue's order.
 */
export const queueFollowUps: Scenario = {
  name: "queue.follow-ups",
  covers: [
    "compact pending gutter",
    "gutter height cap",
    "queue edit",
    "queue reorder",
    "queue cancel",
    "queued delivery order",
  ],
  run: (context) => {
    const followUps = ["follow-up one", "follow-up two", "follow-up three", "follow-up four"];
    return session(
      context,
      {
        steps: [
          {
            name: "queue blocker",
            prompt: "hold while I manage the queue",
            action: { kind: "hold", text: "Queue blocker running" },
          },
          {
            name: "delivered one",
            prompt: "follow-up one edited",
            action: { kind: "reply", text: "Delivered one" },
          },
          {
            name: "delivered three",
            prompt: "follow-up three",
            action: { kind: "reply", text: "Delivered three" },
          },
        ],
      },
      async ({ terminal, provider }) => {
        await terminal.waitForScreen(ready, deadline());
        await type(terminal, "hold while I manage the queue");
        await press(terminal, "chat.submit", (screen) =>
          screen.text.includes("Queue blocker running"),
        );
        const blocker = await provider.waitForRequest((item) => item.script === "queue blocker");
        await provider.waitForStage(blocker.id, "held");

        await beat("each follow-up takes one compact row below the transcript", async () => {
          for (const text of followUps) {
            await type(terminal, text);
            await press(
              terminal,
              "chat.queue.submit",
              (screen) => !composer(screen, text) && gutterRow(screen, text) !== -1,
            );
          }
          const screen = terminal.screen();
          const rows = followUps.map((text) => gutterRow(screen, text));
          for (const [index, row] of rows.entries()) {
            assert.equal(
              screen.lines.filter((line) => line.includes(followUps[index] ?? "")).length,
              1,
              "A queued follow-up is drawn once",
            );
            if (index > 0) assert.equal(row, (rows[index - 1] ?? 0) + 1, "Rows are adjacent");
          }
          const last = screen.lines[rows[3] ?? 0] ?? "";
          assert.ok(last.includes("queue · ctrl+q pending"), "The last row carries the key");
          assert.ok(!screen.text.includes("more ·"), "Nothing is hidden at this height");
          const running = screen.lines.findIndex((line) => line.includes("Queue blocker running"));
          assert.ok(running !== -1 && running < (rows[0] ?? 0), "The gutter sits under the run");
        });

        await beat("a short terminal caps the gutter and counts the hidden rest", async () => {
          const shrink = terminal.resize(80, 13);
          const short = await terminal.waitForScreen(
            (screen) =>
              screen.rows === 13 &&
              screen.text.includes("+1 more · ctrl+q pending") &&
              busy(screen),
            deadline(),
            shrink,
          );
          assert.equal(gutterRow(short, "follow-up four"), -1, "The row past the cap is hidden");
          assert.notEqual(gutterRow(short, "follow-up one"), -1);
          const grow = terminal.resize(80, 24);
          await terminal.waitForScreen(
            (screen) =>
              screen.rows === 24 &&
              !screen.text.includes("more ·") &&
              gutterRow(screen, "follow-up four") !== -1 &&
              busy(screen),
            deadline(),
            grow,
          );
        });

        await beat("the queue edits a follow-up in the composer and saves it back", async () => {
          await press(terminal, "chat.queue.open", (screen) =>
            screen.text.includes("Queued messages"),
          );
          await press(
            terminal,
            "chat.queue.edit",
            (screen) =>
              composer(screen, "follow-up one") && !screen.text.includes("Queued messages"),
          );
          await type(terminal, " edited", { prefix: "follow-up one" });
          await press(
            terminal,
            "chat.submit",
            (screen) =>
              screen.text.includes("Queued message saved") &&
              gutterRow(screen, "follow-up one edited") !== -1,
          );
        });

        await beat("the queue moves a follow-up later and removes another", async () => {
          await press(terminal, "chat.queue.open", (screen) =>
            screen.text.includes("Queued messages"),
          );
          await press(
            terminal,
            "chat.queue.down",
            (screen) =>
              gutterRow(screen, "follow-up two") !== -1 &&
              gutterRow(screen, "follow-up two") < gutterRow(screen, "follow-up one edited"),
          );
          await press(
            terminal,
            "picker.close",
            (screen) => !screen.text.includes("Queued messages"),
          );
          // The menu's cursor starts on the first row, which is now the one to remove.
          await press(
            terminal,
            "chat.queue.open",
            (screen) =>
              screen.text.includes("Queued messages") &&
              (screen.lines[cursorRow(screen)]?.includes("follow-up two") ?? false),
          );
          await press(
            terminal,
            "chat.queue.delete",
            (screen) =>
              screen.text.includes("Removed from the queue") &&
              gutterRow(screen, "follow-up two") === -1,
          );
          await press(
            terminal,
            "chat.queue.open",
            (screen) =>
              screen.text.includes("Queued messages") &&
              (screen.lines[cursorRow(screen)]?.includes("follow-up one edited") ?? false),
          );
          await press(
            terminal,
            "picker.next",
            (screen) => screen.lines[cursorRow(screen)]?.includes("follow-up three") ?? false,
          );
          await press(
            terminal,
            "picker.next",
            (screen) => screen.lines[cursorRow(screen)]?.includes("follow-up four") ?? false,
          );
          await press(
            terminal,
            "chat.queue.delete",
            (screen) =>
              screen.text.includes("Removed from the queue") &&
              gutterRow(screen, "follow-up four") === -1,
          );
          const screen = terminal.screen();
          assert.ok(
            gutterRow(screen, "follow-up one edited") < gutterRow(screen, "follow-up three"),
          );
        });

        await beat(
          "the remaining follow-ups land one at a time, in the queue's order",
          async () => {
            provider.release(blocker.id, " Queue blocker finished");
            await terminal.waitForScreen(
              (screen) =>
                screen.text.includes("Delivered three") &&
                !screen.text.includes("ctrl+q pending") &&
                ready(screen),
              deadline(),
            );
            const delivered = provider.requests
              .filter((item) => item.script.startsWith("delivered"))
              .map((item) => item.prompt);
            assert.deepEqual(delivered, ["follow-up one edited", "follow-up three"]);
            assert.ok(
              !provider.requests.some(
                (item) => item.prompt === "follow-up two" || item.prompt === "follow-up four",
              ),
              "A removed follow-up is never delivered",
            );
            const screen = terminal.screen();
            const one = screen.lines.findIndex((line) => line.includes("follow-up one edited"));
            const three = screen.lines.findIndex((line) => line.includes("follow-up three"));
            assert.ok(one !== -1 && one < three, "Delivered follow-ups read in queue order");
          },
        );
        await quit(terminal);
      },
    );
  },
};
