/**
 * Overlap is impossible by construction; these tests keep it that way.
 * - A turn whose second user message landed mid-turn, at widths 40, 64 and 100:
 *   every block starts exactly one blank row below the block above it.
 * - A source scan of src/ui/transcript/** fails on margins, absolute
 *   positions, translations or a numeric `width=` prop.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { Transcript } from "../../../src/ui/transcript/transcript.tsx";
import { stateOf } from "../../fixture/state.ts";
import { followed, viewOf } from "../../fixture/view.ts";
import { renderWithApp } from "./harness.tsx";

const VIEW = viewOf((v) =>
  v.turn("t1", (t) =>
    t
      .user("First question, long enough to wrap onto several rows when the terminal is narrow")
      .text(
        "An answer paragraph with enough words to wrap at forty columns and keep going for a while longer.",
      )
      .user("Second message landing mid-turn")
      .tool("search", { output: "a\nb\nc\nd\ne\nf\ng" })
      .ended("completed"),
  ),
);

describe("spacing", () => {
  test.each([40, 64, 100])(
    "one blank row between every pair of blocks at width %i",
    async (width) => {
      await using app = await renderWithApp(
        stateOf(followed(VIEW)),
        (current) => (
          <Transcript
            model={() => current.screen().transcript}
            attach={() => () => undefined}
            onScrolled={() => undefined}
            onRevealEarlier={() => undefined}
            onLatest={() => undefined}
          />
        ),
        { width, height: 60 },
      );

      const turn = app.renderer.root.findDescendantById("turn:t1");

      expect(turn).toBeDefined();
      const blocks = turn?.getChildren() ?? [];

      expect(blocks.map((block) => block.id)).toEqual([
        "user:m1",
        "text:m2",
        "user:m3",
        "tool:call-4",
        "status:t1",
      ]);

      for (const [index, block] of blocks.entries()) {
        const above = blocks[index - 1];

        if (above === undefined) continue;
        expect(block.height).toBeGreaterThan(0);
        expect(block.y).toBe(above.y + above.height + 1);
      }

      const frame = app.captureCharFrame();

      expect(frame).toContain("Second message landing");
      expect(frame).toContain("Worked for");
    },
  );

  test("no transcript file sets a margin, an absolute position, a translation or a numeric width", () => {
    const directory = fileURLToPath(new URL("../../../src/ui/transcript/", import.meta.url));

    const offences = readdirSync(directory).flatMap((name) => {
      const source = readFileSync(`${directory}${name}`, "utf8")
        .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
        .replaceAll(/^\s*\/\/.*$/gmu, "");

      return source
        .split("\n")
        .flatMap((line, index) =>
          /\bmargin[A-Za-z]*=|position="absolute"|\btranslate[XY]=|\bwidth=\{\s*\d/u.test(line)
            ? [`${name}:${String(index + 1)}: ${line.trim()}`]
            : [],
        );
    });

    expect(offences).toEqual([]);
  });
});
