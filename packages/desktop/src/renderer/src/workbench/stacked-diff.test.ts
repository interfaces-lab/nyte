import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  EMPTY_PATCH,
  MISSING_WORKING_TREE,
  STACKED_HEADER_HEIGHT,
  STACKED_LIST_PADDING_END,
  STACKED_NOTICE_PADDING,
  activeChangePath,
  diffMarksWidth,
  railLabelMaxWidth,
  stackedGutterWidth,
  stackedOffsets,
  stackedPatchLines,
  stackedScrollHeight,
  stackedSectionHeight,
  uncommittedStackSection,
  visibleStackedRange,
} from "./stacked-diff.ts";

const SAMPLE = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "",
].join("\n");

describe("stacked diff geometry", () => {
  test("measures the hunk header and each displayed line, not git file headers", () => {
    assert.deepEqual(stackedPatchLines(SAMPLE), ["@@ -1,2 +1,2 @@", "keep", "old", "new"]);
  });

  test("builds offsets from pretext heights so spy and jump share one table", () => {
    const offsets = stackedOffsets([
      { path: "a.ts", height: 100 },
      { path: "b.ts", height: 200 },
    ]);
    assert.deepEqual(offsets, [
      { path: "a.ts", top: 0, height: 100 },
      { path: "b.ts", top: 100, height: 200 },
    ]);
    assert.equal(stackedScrollHeight(offsets), 300 + STACKED_LIST_PADDING_END);
    assert.equal(
      activeChangePath({
        offsets,
        scrollTop: offsets[1]!.top,
        viewport: 300,
        scrollHeight: stackedScrollHeight(offsets),
      }),
      "b.ts",
    );
  });

  test("windows the stack from those offsets without reading the DOM", () => {
    const offsets = stackedOffsets([
      { path: "a.ts", height: 400 },
      { path: "b.ts", height: 400 },
      { path: "c.ts", height: 400 },
    ]);
    assert.deepEqual(
      visibleStackedRange({
        offsets,
        scrollTop: offsets[1]!.top,
        viewport: 200,
        overscan: 0,
      }),
      { start: 1, end: 2 },
    );
  });

  test("uses the injected measure for wrap height", () => {
    const height = stackedSectionHeight({
      section: { kind: "diff", path: "a.ts", patch: SAMPLE },
      contentWidth: 40,
      measureHeight: (text) => (text.length > 6 ? 40 : 20),
    });
    assert.equal(height, STACKED_HEADER_HEIGHT + 40 + 20 + 20 + 20);
  });

  test("pending files are header-only until the patch arrives", () => {
    assert.equal(
      stackedSectionHeight({
        section: { kind: "pending", path: "a.ts" },
        contentWidth: 200,
        measureHeight: () => 40,
      }),
      STACKED_HEADER_HEIGHT,
    );
  });

  test("notices keep a header so the rail still has a section to jump to", () => {
    const height = stackedSectionHeight({
      section: { kind: "notice", path: "gone.ts", text: MISSING_WORKING_TREE },
      contentWidth: 200,
      measureHeight: () => 32,
    });
    assert.equal(height, STACKED_HEADER_HEIGHT + STACKED_NOTICE_PADDING + 32);
  });

  test("maps an uncommitted fetch state to a stack section", () => {
    assert.deepEqual(uncommittedStackSection({ path: "a.ts", state: { kind: "absent" } }), {
      kind: "notice",
      path: "a.ts",
      text: MISSING_WORKING_TREE,
    });
    assert.deepEqual(uncommittedStackSection({ path: "a.ts", state: { kind: "pending" } }), {
      kind: "pending",
      path: "a.ts",
    });
    assert.deepEqual(
      uncommittedStackSection({ path: "a.ts", state: { kind: "ready", patch: SAMPLE } }),
      { kind: "diff", path: "a.ts", patch: SAMPLE },
    );
    assert.deepEqual(uncommittedStackSection({ path: "a.ts", state: { kind: "empty" } }), {
      kind: "notice",
      path: "a.ts",
      text: EMPTY_PATCH,
    });
  });

  test("picks the file whose stacked section has reached the top", () => {
    const offsets = [
      { path: "a.ts", top: 0 },
      { path: "b.ts", top: 400 },
      { path: "c.ts", top: 900 },
    ];
    assert.equal(
      activeChangePath({ offsets, scrollTop: 0, viewport: 300, scrollHeight: 1400 }),
      "a.ts",
    );
    assert.equal(
      activeChangePath({ offsets, scrollTop: 400, viewport: 300, scrollHeight: 1400 }),
      "b.ts",
    );
    assert.equal(
      activeChangePath({ offsets, scrollTop: 1200, viewport: 300, scrollHeight: 1400 }),
      "c.ts",
    );
  });

  test("sizes the rail label slot from the same chrome the row paints", () => {
    assert.equal(stackedGutterWidth(24), 44);
    assert.equal(
      railLabelMaxWidth({ rowWidth: 174, depth: 1, statsWidth: 28, hasPip: true }),
      174 - 12 - 10 - 16 - 5 - 33 - 11,
    );
    assert.equal(
      diffMarksWidth({
        added: 45,
        removed: 6,
        measure: (text) => text.length * 6,
      }),
      3 * 6 + 3 + 2 * 6,
    );
  });
});
