import { expect, onTestFinished, test } from "vitest";
import { OptimizedBuffer, RGBA } from "@opentui/core";

const background = RGBA.fromHex("#000000");
const fill = RGBA.fromHex("#ff0000");
function createBuffer(): OptimizedBuffer {
  const buffer = OptimizedBuffer.create(5, 4, "unicode");
  onTestFinished(() => buffer.destroy());
  buffer.clear(background);
  return buffer;
}

function expectRows(buffer: OptimizedBuffer, rows: readonly string[]): void {
  expect(
    buffer
      .getSpanLines()
      .map((line) =>
        line.spans.flatMap((span) => Array.from({ length: span.width }, () => span.bg.toInts())),
      ),
  ).toEqual(
    rows.map((row) => row.split("").map((cell) => (cell === "#" ? fill : background).toInts())),
  );
}

test.each([
  { x: -2, y: -1, width: 4, height: 3, rows: ["##...", "##...", ".....", "....."] },
  { x: 3, y: 2, width: 4, height: 3, rows: [".....", ".....", "...##", "...##"] },
  { x: -10, y: -10, width: 20, height: 20, rows: ["#####", "#####", "#####", "#####"] },
  { x: -2, y: -1, width: 2, height: 1, rows: [".....", ".....", ".....", "....."] },
  { x: 5, y: 4, width: 2, height: 1, rows: [".....", ".....", ".....", "....."] },
  { x: 1, y: 1, width: 0, height: 2, rows: [".....", ".....", ".....", "....."] },
])("clips rectangle $x,$y,$width,$height to the buffer", (rect) => {
  const buffer = createBuffer();
  buffer.fillRect(rect.x, rect.y, rect.width, rect.height, fill);
  expectRows(buffer, rect.rows);
});

test("offscreen fills still respect the enclosing viewport", () => {
  const buffer = createBuffer();
  buffer.pushScissorRect(1, 1, 3, 2);
  buffer.fillRect(-2, -2, 10, 10, fill);
  buffer.popScissorRect();
  expectRows(buffer, [".....", ".###.", ".###.", "....."]);
});
