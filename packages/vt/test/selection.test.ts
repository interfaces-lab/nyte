import { describe, expect, test } from "vitest";

import { openTerminal } from "./harness.ts";

import type { SelectionInput } from "../src/index.ts";

const cell = { width: 8, height: 16 };

function at(
  action: SelectionInput["action"],
  col: number,
  row: number,
  time: number,
): SelectionInput {
  const inset = action === "drag" ? cell.width - 2 : 2;

  return {
    action,
    col,
    row,
    x: col * cell.width + inset,
    y: row * cell.height + 2,
    time,
    rectangle: false,
  };
}

describe("selection", () => {
  test("press and drag select text", async () => {
    const session = await openTerminal({ cols: 40, rows: 5 });
    const terminal = session.terminal;

    session.write("hello world\r\nsecond line");
    terminal.select(at("press", 0, 0, 1000));
    expect(terminal.hasSelection()).toBe(false);
    terminal.select(at("drag", 4, 0, 1010));
    terminal.select(at("release", 4, 0, 1020));
    expect(terminal.hasSelection()).toBe(true);
    expect(terminal.selectionText()).toBe("hello");
    expect(terminal.frame(true).rows[0]?.selection).toEqual([0, 4]);
    terminal.clearSelection();
    expect(terminal.hasSelection()).toBe(false);
  });

  test("double click selects a word and triple click a line", async () => {
    const session = await openTerminal({ cols: 40, rows: 5 });
    const terminal = session.terminal;

    session.write("hello world\r\nsecond line");
    terminal.select(at("press", 8, 0, 1000));
    terminal.select(at("release", 8, 0, 1050));
    terminal.select(at("press", 8, 0, 1200));
    expect(terminal.selectionText()).toBe("world");
    terminal.select(at("release", 8, 0, 1250));
    terminal.select(at("press", 8, 0, 1400));
    expect(terminal.selectionText()).toBe("hello world");
    terminal.selectAll();
    expect(terminal.selectionText()).toBe("hello world\nsecond line");
  });

  test("a cursor-line mark follows its row until scrollback drops it", async () => {
    const session = await openTerminal({ cols: 40, rows: 5, scrollback: 1_000 });
    const terminal = session.terminal;

    session.write("$ ls\r\nREADME.md\r\n\u001b[1m$ make\u001b[0m   ");
    const mark = terminal.markCursorLine();

    expect(mark?.text).toBe("$ make");
    expect(mark?.row()).toBe(2);
    session.write(`\r\n${Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\r\n")}`);
    expect(mark?.row()).toBe(2);
    terminal.scroll(-1_000);
    terminal.select(at("press", 0, 2, 1000));
    terminal.select(at("drag", 5, 2, 1010));
    expect(terminal.selectionText()).toBe("$ make");
    expect(terminal.selectionTop()).toBe(mark?.row());
    terminal.scrollToBottom();
    session.write(Array.from({ length: 50_000 }, (_, i) => `\r\nmore ${i}`).join(""));
    expect(mark?.row()).toBeNull();
    mark?.dispose();
    mark?.dispose();
  });

  test("no mark on an empty line or the alternate screen", async () => {
    const session = await openTerminal({ cols: 40, rows: 5 });

    expect(session.terminal.markCursorLine()).toBeNull();
    session.write("\u001b[?1049hvim");
    expect(session.terminal.markCursorLine()).toBeNull();
  });
});
