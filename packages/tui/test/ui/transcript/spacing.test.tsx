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
});
