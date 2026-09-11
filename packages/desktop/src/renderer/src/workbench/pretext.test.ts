import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { canvasFont, middleEllipsis, truncateMiddleText, truncateStartText } from "./pretext.ts";

describe("pretext helpers", () => {
  test("builds a canvas font string from face, size, and optional weight", () => {
    assert.equal(
      canvasFont({ fontFamily: '"Inter Variable"', fontSize: "12px" }),
      '12px "Inter Variable"',
    );
    assert.equal(
      canvasFont({
        fontFamily: "Menlo",
        fontSize: "12px",
        fontWeight: "590",
        fontStyle: "italic",
      }),
      "italic 590 12px Menlo",
    );
  });

  test("puts the ellipsis in the middle of the kept span", () => {
    assert.equal(middleEllipsis("styles.stylex.ts", 16), "styles.stylex.ts");
    assert.equal(middleEllipsis("styles.stylex.ts", 0), "…");
    assert.equal(middleEllipsis("styles.stylex.ts", 8), "styl…x.ts");
  });

  test("binary-searches the longest middle-ellipsis that still fits", () => {
    const fits = (value: string): boolean => value.length <= 9;
    assert.equal(truncateMiddleText({ text: "composer.tsx", maxWidth: 80, fits }), "comp….tsx");
    assert.equal(
      truncateMiddleText({ text: "short.ts", maxWidth: 80, fits: (value) => value.length <= 20 }),
      "short.ts",
    );
    assert.equal(truncateMiddleText({ text: "composer.tsx", maxWidth: 0, fits }), "composer.tsx");
  });

  test("keeps the filename when the path is too long", () => {
    const fits = (value: string): boolean => value.length <= 10;
    assert.equal(
      truncateStartText({ text: "packages/core/src/nyte.ts", maxWidth: 80, fits }),
      "…c/nyte.ts",
    );
    assert.equal(truncateStartText({ text: "nyte.ts", maxWidth: 80, fits }), "nyte.ts");
  });
});
