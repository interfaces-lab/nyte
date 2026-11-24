import { describe, expect, test } from "vitest";

import { frameText, openTerminal } from "./harness.ts";

describe("effects", () => {
  test("answers device attributes and cursor position after the write", async () => {
    const session = await openTerminal();

    session.write("ab\u001B[c\u001B[>c\u001B[6n");
    expect(session.replies).toEqual(["\u001B[?62;22c", "\u001B[>1;0;0c", "\u001B[1;3R"]);
  });

  test("answers a color scheme query from colorScheme()", async () => {
    const dark = await openTerminal({ scheme: "dark" });
    const light = await openTerminal({ scheme: "light" });

    dark.write("\u001B[?996n");
    light.write("\u001B[?996n");
    expect(dark.replies).toEqual(["\u001B[?997;1n"]);
    expect(light.replies).toEqual(["\u001B[?997;2n"]);
  });

  test("reports a color scheme change only after the program asks", async () => {
    const session = await openTerminal({ scheme: "dark" });

    session.terminal.colorSchemeChanged("light");
    expect(session.replies).toEqual([]);
    session.write("\u001B[?2031h");
    session.terminal.colorSchemeChanged("dark");
    session.terminal.colorSchemeChanged("light");
    session.write("\u001B[?996n");
    expect(session.replies).toEqual(["\u001B[?997;1n", "\u001B[?997;2n", "\u001B[?997;2n"]);
  });

  test("reports title changes", async () => {
    const session = await openTerminal();

    session.write("\u001B]2;build: ok\u0007");
    expect(session.titles).toEqual(["build: ok"]);
  });

  test("a reply handler may write without recursing or reordering", async () => {
    const session = await openTerminal({ cols: 20, rows: 3 });
    const seen: [depth: number, reply: string][] = [];
    let depth = 0;

    session.onReply((reply) => {
      depth += 1;
      seen.push([depth, reply]);

      if (seen.length === 1) session.write("X\u001B[6n");
      depth -= 1;
    });
    session.write("\u001B[c\u001B[6n");
    expect(seen).toEqual([
      [1, "\u001B[?62;22c"],
      [1, "\u001B[1;1R"],
      [1, "\u001B[1;2R"],
    ]);
    expect(frameText(session.terminal)[0]).toBe("X");
  });
});
