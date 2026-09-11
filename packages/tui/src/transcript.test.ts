import { describe, expect, test } from "bun:test";
import { diffFromOutput } from "./output-diff.ts";
import { wordSpans } from "./transcript.ts";

/** The unified view's content: hunk rows minus their sign, joined by newlines. */
const content = (rows: readonly string[]) => rows.join("\n");

describe("wordSpans", () => {
  test("marks the changed word on each row at absolute offsets", () => {
    const removed = "  const total = price * qty;";
    const added = "  const total = price * quantity;";
    const text = content(["function f() {", removed, added, "}"]);
    const spans = wordSpans(text, { removed, added, row: 1 });
    expect(spans.map(([start, end, group]) => [text.slice(start, end), group])).toEqual([
      ["qty", "diff.minus"],
      ["quantity", "diff.plus"],
    ]);
  });

  test("counts UTF-16 code units so spans after non-ASCII text still land", () => {
    const removed = "naïve = 😀 + old";
    const added = "naïve = 😀 + new";
    const text = content([removed, added]);
    const spans = wordSpans(text, { removed, added, row: 0 });
    expect(spans.map(([start, end]) => text.slice(start, end))).toEqual(["old", "new"]);
    expect(spans[0]?.[0]).toBe(removed.indexOf("old"));
    expect(spans[1]?.[0]).toBe(removed.length + 1 + added.indexOf("new"));
  });

  test("ignores whitespace-only changes", () => {
    const removed = "a = b";
    const added = "a  =  b";
    expect(wordSpans(content([removed, added]), { removed, added, row: 0 })).toEqual([]);
  });

  test("returns nothing when the rows do not match the pair", () => {
    expect(wordSpans("x\ny", { removed: "a", added: "b", row: 0 })).toEqual([]);
  });

  test("returns nothing above the size cap", () => {
    const removed = "a".repeat(2_500);
    const added = "b".repeat(2_500);
    expect(wordSpans(content([removed, added]), { removed, added, row: 0 })).toEqual([]);
  });
});

describe("diffFromOutput pair", () => {
  test("finds an adjacent one-line replacement and its row", () => {
    const diff = diffFromOutput(
      ["--- a/x.ts", "+++ b/x.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+c", " d"].join("\n"),
    );
    expect(diff?.files[0]?.sections[0]?.pair).toEqual({ removed: "b", added: "c", row: 1 });
  });

  test("leaves multi-line hunks unpaired", () => {
    const diff = diffFromOutput(
      ["--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,3 @@", "-a", "+b", "+c", " d"].join("\n"),
    );
    expect(diff?.files[0]?.sections[0]?.pair).toBeUndefined();
  });
});
