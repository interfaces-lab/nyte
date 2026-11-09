import { afterEach, describe, expect, test, vi } from "vitest";

import { frameText, openTerminal, screenText } from "./harness.ts";

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
    expect(scrollbar.total).toBeLessThan(11_000);
    expect(scrollbar.length).toBe(40);
  });

  test("clusters an emoji with its modifier into one wide cell", async () => {
    const session = await openTerminal({ cols: 10, rows: 2 });

    session.write("\u{1F44D}\u{1F3FD}x");
    session.terminal.frame(true);
    const screen = session.terminal.screen;

    expect([0, 1, 2].map((index) => [screen.text(index), screen.width[index]])).toEqual([
      ["\u{1F44D}\u{1F3FD}", 2],
      ["", 0],
      ["x", 1],
    ]);
  });

  test("shows the finished synchronized frame while the next one is half drawn", async () => {
    const session = await openTerminal({ cols: 20, rows: 2 });
    const top = () => frameText(session.terminal)[0];

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
    expect([screenText(session.terminal.screen)[0], held.held]).toEqual(["BASE", true]);
    vi.advanceTimersByTime(1_050);
    const released = session.terminal.frame(true);
    expect([screenText(session.terminal.screen)[0], released.held]).toEqual(["stuck", false]);
    session.write("\u001b[H\u001b[2Jlive");
    expect(frameText(session.terminal)[0]).toBe("live");
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
    expect(frameText(session.terminal)[0]).toBe("€ red");
    expect(session.terminal.screen.fg[2]).toBe(0xff0000);
    expect(session.terminal.screen.text(2)).toBe("r");
  });

  test("reads an OSC 8 hyperlink's URI from each of its cells and nothing from plain text", async () => {
    const session = await openTerminal();
    const url = "https://ghostty.org/docs?q=é";

    session.write(`ab\u001b]8;;${url}\u001b\\link\u001b]8;;\u001b\\cd`);

    expect(Array.from({ length: 8 }, (_, col) => session.terminal.hyperlink(col, 0))).toEqual([
      null,
      null,
      url,
      url,
      url,
      url,
      null,
      null,
    ]);
  });

  test("marks the rows the terminal soft-wrapped, not the ones a newline ended", async () => {
    const session = await openTerminal({ cols: 10, rows: 4 });

    session.write("0123456789abcdefghij-wrapped\r\nshort");

    session.terminal.frame(true);
    expect([...session.terminal.screen.wrapped]).toEqual([1, 1, 0, 0]);
  });

  test("newline mode returns the carriage on line feed", async () => {
    const session = await openTerminal({ cols: 20, rows: 3, newlineMode: true });

    session.write("a\nb");
    expect(frameText(session.terminal).slice(0, 2)).toEqual(["a", "b"]);
  });

  test("rewrites only dirty rows and keeps the rest of the screen", async () => {
    const session = await openTerminal({ cols: 20, rows: 4 });

    session.write("one\r\ntwo");
    expect(session.terminal.frame(true).dirty).toEqual([0, 1, 2, 3]);
    expect(session.terminal.frame(false).dirty).toEqual([]);
    session.write("!");
    expect(session.terminal.frame(false).dirty).toEqual([1]);
    expect(screenText(session.terminal.screen).slice(0, 2)).toEqual(["one", "two!"]);
  });

  test("dispose is idempotent and later calls throw", async () => {
    const session = await openTerminal();

    session.terminal.dispose();
    session.terminal.dispose();
    expect(() => session.write("x")).toThrow("disposed");
  });
});
