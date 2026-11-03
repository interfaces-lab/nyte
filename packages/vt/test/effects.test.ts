import { describe, expect, test } from "vitest";

import { openTerminal, screenText } from "./harness.ts";

describe("effects", () => {
  test("answers device attributes and cursor position after the write", async () => {
    const session = await openTerminal();

    session.write("ab\u001b[c\u001b[>c\u001b[6n");
    expect(session.replies).toEqual(["\u001b[?62;22c", "\u001b[>1;10;0c", "\u001b[1;3R"]);
  });

  test("answers a color scheme query from colorScheme()", async () => {
    const dark = await openTerminal({ scheme: "dark" });
    const light = await openTerminal({ scheme: "light" });

    dark.write("\u001b[?996n");
    light.write("\u001b[?996n");
    expect(dark.replies).toEqual(["\u001b[?997;1n"]);
    expect(light.replies).toEqual(["\u001b[?997;2n"]);
  });

  test("reports a color scheme change only after the program asks", async () => {
    const session = await openTerminal({ scheme: "dark" });

    session.terminal.colorSchemeChanged("light");
    expect(session.replies).toEqual([]);
    session.write("\u001b[?2031h");
    session.terminal.colorSchemeChanged("dark");
    session.write("\u001b[?996n");
    expect(session.replies).toEqual(["\u001b[?997;1n", "\u001b[?997;1n"]);
  });

  test("reports title changes", async () => {
    const session = await openTerminal();

    session.write("\u001b]2;build: ok\u0007");
    expect(session.titles).toEqual(["build: ok"]);
  });

  test("a reply handler may write without recursing or reordering", async () => {
    const session = await openTerminal({ cols: 20, rows: 3 });
    const seen: string[] = [];

    session.onReply((reply) => {
      seen.push(reply);

      if (seen.length === 1) session.write("\u001b[6nX");
    });
    session.write("\u001b[c\u001b[6n");
    expect(seen).toEqual(["\u001b[?62;22c", "\u001b[1;1R", "\u001b[1;1R"]);
    expect(screenText(session.terminal.frame(true))[0]).toBe("X");
  });
});
