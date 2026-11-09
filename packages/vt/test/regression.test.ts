import { describe, expect, test } from "vitest";

import { frameText, openTerminal } from "./harness.ts";

const esc = "\u001b";

const bold = (text: string) => `${esc}[1m${text}${esc}[0m`;

function renderingFixture() {
  const rule = bold("═".repeat(80));

  const palette = Array.from(
    { length: 8 },
    (_, row) =>
      `  ${Array.from({ length: 32 }, (_, i) => `${esc}[48;5;${row * 32 + i}m  ${esc}[0m`).join("")}`,
  );

  const gradients = Array.from({ length: 8 }, (_, row) => {
    const channel = (i: number, offset: number) =>
      Math.floor(Math.sin(i * 0.08 + row + offset) * 127 + 128);

    return `  ${Array.from(
      { length: 80 },
      (_, i) => `${esc}[48;2;${channel(i, 0)};${channel(i, 2)};${channel(i, 4)}m ${esc}[0m`,
    ).join("")}`;
  });

  const grids = Array.from({ length: 8 }, (_, section) => [
    bold(`── ${section + 5}. COLOR GRID ${String.fromCharCode(65 + section)} ──`),
    ...Array.from({ length: 8 }, (_, row) => {
      const cells = Array.from({ length: 70 }, (_, i) => {
        const index = (section * 64 + row * 8 + i) % 256;

        return (i + row) % 3 === 0
          ? `${esc}[38;2;${(index * 7) % 256};${(index * 13) % 256};${(index * 23) % 256}m*${esc}[0m`
          : `${esc}[38;5;${index}m*${esc}[0m`;
      });

      return `  ${cells.join("")}`;
    }),
    "",
  ]);

  const lines = [
    rule,
    bold("  Terminal Rendering Test"),
    rule,
    "",
    bold("── 1. 256-COLOR PALETTE ──"),
    ...palette,
    "",
    bold("── 2. TRUECOLOR GRADIENTS ──"),
    ...gradients,
    "",
    bold("── 3. TEXT ATTRIBUTES ──"),
    `  ${bold("Bold")}  ${esc}[3mItalic${esc}[0m  ${esc}[4mUnderline${esc}[0m  ${esc}[7mReverse${esc}[0m  ${esc}[9mStrike${esc}[0m`,
    `  ${esc}[1;3mBold+Italic${esc}[0m  ${esc}[1;4mBold+Under${esc}[0m  ${esc}[3;4mItalic+Under${esc}[0m`,
    "",
    bold("── 4. UNICODE BOX DRAWING ──"),
    "  ┌──────────┬──────────┬──────────┐",
    "  │  Cell A   │  Cell B   │  Cell C   │",
    "  ├──────────┼──────────┼──────────┤",
    "  │  Cell D   │  Cell E   │  Cell F   │",
    "  └──────────┴──────────┴──────────┘",
    "",
    ...grids.flat(),
    rule,
    `  ${esc}[32m✓${esc}[0m Test complete`,
    rule,
    "",
  ];

  return new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
}

describe("viewport rows after repeated escape-heavy output", () => {
  const fixture = renderingFixture();

  test.each([160, 120, 200])("%i columns keep identical text across 30 writes", async (cols) => {
    const session = await openTerminal({ cols, rows: 39 });

    const screens = Array.from({ length: 30 }, () => {
      session.terminal.write(fixture);

      return frameText(session.terminal);
    });

    expect(fixture.length).toBeGreaterThan(90_000);
    expect(screens[0]?.slice(-4).join("\n")).toContain("✓ Test complete");
    screens.forEach((screen) => expect(screen).toEqual(screens[0]));
  });
});
