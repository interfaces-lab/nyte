import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RunEnd } from "@uji-ai/core";
import { notifyRunEvent, runEndMessage } from "../src/notifications.ts";

interface RecordedNotification {
  message: string;
  title: string | undefined;
}

function renderer(result = true): {
  notifications: RecordedNotification[];
  triggerNotification(message: string, title?: string): boolean;
} {
  return {
    notifications: [],
    triggerNotification(message, title) {
      this.notifications.push({ message, title });
      return result;
    },
  };
}

function output(isTTY = true): { isTTY: boolean; text: string; write(text: string): void } {
  return {
    isTTY,
    text: "",
    write(text) {
      this.text += text;
    },
  };
}

const completed: RunEnd = { kind: "completed" };
const aborted: RunEnd = { kind: "aborted" };
const failed: RunEnd = { kind: "failed", error: { message: "Connection error." } };

void describe("run notifications", () => {
  void test("asks OpenTUI to notify when the run stops", () => {
    const terminal = renderer();
    notifyRunEvent({ end: completed, mode: "alert", renderer: terminal });
    assert.deepEqual(terminal.notifications, [{ message: "Turn finished", title: "Uji" }]);
  });

  void test("adds a terminal bell only in sound mode", () => {
    const terminal = renderer();
    const bell = output();
    notifyRunEvent({ end: completed, mode: "sound", renderer: terminal, output: bell });
    assert.deepEqual(terminal.notifications, [{ message: "Turn finished", title: "Uji" }]);
    assert.equal(bell.text, "\u0007");
  });

  void test("stays quiet when disabled and contains renderer failures", () => {
    const terminal = renderer();
    notifyRunEvent({ end: completed, mode: "off", renderer: terminal });
    assert.deepEqual(terminal.notifications, []);

    assert.doesNotThrow(() =>
      notifyRunEvent({
        end: completed,
        mode: "alert",
        renderer: {
          triggerNotification() {
            throw new Error("notification failed");
          },
        },
      }),
    );
  });

  void test("does not write a bell when stdout is not a terminal", () => {
    const bell = output(false);
    notifyRunEvent({ end: completed, mode: "sound", renderer: renderer(false), output: bell });
    assert.equal(bell.text, "");
  });

  void test("a failed run never reads as a clean finish", () => {
    const terminal = renderer();
    notifyRunEvent({ end: failed, mode: "alert", renderer: terminal });
    assert.deepEqual(terminal.notifications, [
      { message: "Turn failed: Connection error.", title: "Uji" },
    ]);
  });

  void test("an abort is reported as stopped, not finished", () => {
    const terminal = renderer();
    notifyRunEvent({ end: aborted, mode: "alert", renderer: terminal });
    assert.deepEqual(terminal.notifications, [{ message: "Turn stopped", title: "Uji" }]);
  });
});

void describe("run end message", () => {
  void test("collapses whitespace and bounds long provider errors", () => {
    const message = runEndMessage({
      ...failed,
      error: { message: `${"x".repeat(400)}\n\nrequest id 1` },
    });
    assert.ok(message.startsWith("Turn failed: xxx"));
    assert.ok(message.endsWith("…"));
    assert.ok(message.length < 200);
    assert.ok(!message.includes("\n"));
  });

  void test("falls back when the provider supplies no text", () => {
    assert.equal(runEndMessage({ ...failed, error: { message: "  " } }), "Turn failed");
  });
});
