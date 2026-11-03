import { afterEach, describe, expect, test, vi } from "vitest";

import { openTerminal, screenText } from "./harness.ts";

describe("terminal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("keeps the configured scrollback instead of the default byte cap", async () => {
    const session = await openTerminal({ cols: 160, rows: 40, scrollback: 10_000 });

    const lines = Array.from(
      { length: 12_000 },
      (_, i) =>
        `\u001b[2m${String(i).padStart(6)}\u001b[0m \u001b[3${1 + (i % 6)}m[build]\u001b[0m compiling file-${i}.ts\r\n`,
    );

    session.write(lines.join(""));
    const scrollbar = session.terminal.scrollbar();

    expect(scrollbar.total).toBeGreaterThan(9_500);
    expect(scrollbar.total).toBeLessThan(12_040);
    expect(scrollbar.length).toBe(40);
  });

  test("clusters an emoji with its modifier into one wide cell", async () => {
    const session = await openTerminal({ cols: 10, rows: 2 });

    session.write("\u{1F44D}\u{1F3FD}x");
    const cells = session.terminal.frame(true).rows[0]?.cells ?? [];

    expect(cells.slice(0, 3).map((cell) => [cell.text, cell.width])).toEqual([
      ["\u{1F44D}\u{1F3FD}", 2],
      ["", 0],
      ["x", 1],
    ]);
  });

  test("shows the finished synchronized frame while the next one is half drawn", async () => {
    const session = await openTerminal({ cols: 20, rows: 2 });
    const top = () => screenText(session.terminal.frame(true))[0];

    session.write("BASE");
    expect(top()).toBe("BASE");
    session.write(
      "\u001b[?2026h\u001b[H\u001b[2JFINISHED\u001b[?2026l\u001b[?2026h\u001b[H\u001b[2Jpart",
    );
    expect(top()).toBe("FINISHED");
    session.write("ial\u001b[?2026l");
    expect(top()).toBe("partial");
  });

  test("gives up on a synchronized frame held longer than a second", async () => {
    const session = await openTerminal({ cols: 20, rows: 2 });
    vi.useFakeTimers({ toFake: ["performance"] });

    session.write("BASE\u001b[?2026h\u001b[H\u001b[2Jstuck");
    const held = session.terminal.frame(true);
    expect([screenText(held)[0], held.held]).toEqual(["BASE", true]);
    vi.advanceTimersByTime(1_050);
    const released = session.terminal.frame(true);
    expect([screenText(released)[0], released.held]).toEqual(["stuck", false]);
    session.write("\u001b[H\u001b[2Jlive");
    expect(screenText(session.terminal.frame(true))[0]).toBe("live");
  });

  test("reports alternate scroll only on the alternate screen with mode 1007", async () => {
    const session = await openTerminal();

    expect(session.terminal.alternateScroll()).toBe(false);
    session.write("\u001b[?1049h");
    expect(session.terminal.alternateScroll()).toBe(true);
    session.write("\u001b[?1007l");
    expect(session.terminal.alternateScroll()).toBe(false);
  });

  test("joins a UTF-8 character and an escape sequence split across writes", async () => {
    const session = await openTerminal({
      cols: 20,
      rows: 3,
      palette: {
        foreground: 0xffffff,
        background: 0,
        cursor: 0xffffff,
        ansi: [0x000000, 0xff0000],
      },
    });

    session.terminal.write(new Uint8Array([0xe2, 0x82]));
    session.terminal.write(new Uint8Array([0xac]));
    session.write(" \u001b[3");
    session.write("1mred\u001b[0m");
    const row = session.terminal.frame(true).rows[0];

    expect(screenText(session.terminal.frame(true))[0]).toBe("€ red");
    expect(row?.cells[2]?.fg).toBe(0xff0000);
    expect(row?.cells[2]?.text).toBe("r");
  });

  test("newline mode returns the carriage on line feed", async () => {
    const session = await openTerminal({ cols: 20, rows: 3, newlineMode: true });

    session.write("a\nb");
    expect(screenText(session.terminal.frame(true)).slice(0, 2)).toEqual(["a", "b"]);
  });

  test("returns only dirty rows after a full frame", async () => {
    const session = await openTerminal({ cols: 20, rows: 4 });

    session.write("one\r\ntwo");
    expect(session.terminal.frame(true).rows).toHaveLength(4);
    expect(session.terminal.frame(false).rows).toHaveLength(0);
    session.write("!");
    expect(session.terminal.frame(false).rows.map((row) => row.y)).toEqual([1]);
  });

  test("dispose is idempotent and later calls throw", async () => {
    const session = await openTerminal();

    session.terminal.dispose();
    session.terminal.dispose();
    expect(() => session.write("x")).toThrow("disposed");
  });
});
