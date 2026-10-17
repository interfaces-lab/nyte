import { RGBA } from "@opentui/core";
import { expect, test } from "bun:test";
import { DARK_THEME } from "../../../src/lib/theme.ts";
import type { TextDialog } from "../../../src/model/dialogs/dialog.ts";
import { key, renderDialog, rows } from "./harness.tsx";

const LINES = Array.from({ length: 40 }, (_, index) => `line ${String(index + 1)}`);

const TEXT: TextDialog = {
  kind: "text",
  id: "x1",
  title: "Keyboard shortcuts",
  body: { kind: "ready", lines: LINES },
  scroll: 0,
};

function visible(frame: string, line: string): boolean {
  return rows(frame).some((row) => new RegExp(`^\\s*${line}(\\s|$)`, "u").test(row));
}

test("the panel shows the first lines at widths 40 and 100", async () => {
  for (const width of [40, 100]) {
    await using app = await renderDialog(TEXT, { width, height: 14 });
    const frame = app.frame();

    expect(frame).toContain("Keyboard shortcuts");
    expect(visible(frame, "line 1")).toBe(true);
    expect(visible(frame, "line 40")).toBe(false);
    expect(frame).toContain("esc close");
  }
});

test("paging and stepping scroll the lines", async () => {
  await using app = await renderDialog(TEXT, { height: 14 });
  await app.send(key("picker.page.down"));
  let frame = app.frame();

  expect(visible(frame, "line 11")).toBe(true);
  expect(visible(frame, "line 1")).toBe(false);
  await app.send(key("picker.next"));
  frame = app.frame();
  expect(visible(frame, "line 12")).toBe(true);
  expect(visible(frame, "line 11")).toBe(false);
  await app.send(key("chat.message.next"));
  frame = app.frame();
  expect(visible(frame, "line 40")).toBe(true);
  await app.send(key("chat.message.previous"));
  expect(visible(app.frame(), "line 1")).toBe(true);
});

test("loading and failed bodies say so", async () => {
  await using loading = await renderDialog({ ...TEXT, body: { kind: "loading" } });

  expect(loading.frame()).toContain("Loading…");

  await using failed = await renderDialog({
    ...TEXT,
    body: { kind: "failed", message: "No usage recorded" },
  });

  expect(failed.frame()).toContain("No usage recorded");
});

test("spans draw in their tone", async () => {
  await using app = await renderDialog({
    ...TEXT,
    body: {
      kind: "ready",
      lines: [
        [
          { text: "━━━━", tone: "error" },
          { text: "────", tone: "muted" },
        ],
      ],
    },
  });

  const spans = app.captureSpans().lines.flatMap((line) => line.spans);

  expect(spans.find((span) => span.text.includes("━━━━"))?.fg.toString()).toBe(
    RGBA.fromHex(DARK_THEME.error).toString(),
  );
  expect(spans.find((span) => span.text.includes("────"))?.fg.toString()).toBe(
    RGBA.fromHex(DARK_THEME.muted).toString(),
  );
});
