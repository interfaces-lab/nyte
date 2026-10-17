import { describe, expect, it } from "vitest";
import { readHunks, writePatch } from "../src/index.ts";
import type { Hunk } from "../src/index.ts";

const hunks: readonly Hunk[] = [
  {
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    header: "function sum()",
    lines: [
      { kind: "context", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "+++ c", noNewline: true },
    ],
  },
  {
    oldStart: 9,
    oldLines: 1,
    newStart: 9,
    newLines: 0,
    header: null,
    lines: [{ kind: "remove", text: "" }],
  },
];

describe("unified patches", () => {
  it("writes hunks as git prints them and reads the same hunks back", () => {
    const patch = writePatch("src/a.ts", "modified", hunks);

    expect(patch).toBe(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,2 @@ function sum()",
        " a",
        "-b",
        "++++ c",
        "\\ No newline at end of file",
        "@@ -9,1 +9,0 @@",
        "-",
        "",
      ].join("\n"),
    );
    expect(readHunks(patch)).toEqual(hunks);
  });

  it("names /dev/null for the side an added or deleted file lacks", () => {
    expect(writePatch("a", "untracked", []).split("\n").slice(1, 3)).toEqual([
      "--- /dev/null",
      "+++ b/a",
    ]);
    expect(writePatch("a", "deleted", []).split("\n").slice(1, 3)).toEqual([
      "--- a/a",
      "+++ /dev/null",
    ]);
  });

  it("reads a git hunk header without counts as one line", () => {
    expect(readHunks("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3 +3 @@\n-x\n+y\n")).toEqual([
      {
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 1,
        header: null,
        lines: [
          { kind: "remove", text: "x" },
          { kind: "add", text: "y" },
        ],
      },
    ]);
  });
});
