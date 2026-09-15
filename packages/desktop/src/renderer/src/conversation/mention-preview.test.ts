import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { mentionPreviewRows } from "./mention-preview.ts";

describe("mentionPreviewRows", () => {
  test("walks a file down its folders", () => {
    assert.deepEqual(mentionPreviewRows(".github/workflows/ci.yml"), [
      { kind: "folder", label: ".github" },
      { kind: "folder", label: "workflows" },
      { kind: "file", label: "ci.yml" },
    ]);
  });

  test("ends a folder mention on the folder itself", () => {
    assert.deepEqual(mentionPreviewRows(".github/workflows/"), [
      { kind: "folder", label: ".github" },
      { kind: "folder", label: "workflows" },
    ]);
  });

  test("keeps a file at the workspace root to one row", () => {
    assert.deepEqual(mentionPreviewRows("README.md"), [{ kind: "file", label: "README.md" }]);
  });

  test("collapses the folders above the last four", () => {
    assert.deepEqual(mentionPreviewRows("packages/desktop/src/renderer/src/app.tsx"), [
      { kind: "folder", label: "packages" },
      { kind: "folder", label: "desktop" },
      { kind: "folder", label: "src" },
      { kind: "folder", label: "renderer" },
      { kind: "folder", label: "src" },
      { kind: "file", label: "app.tsx" },
    ]);
    assert.deepEqual(mentionPreviewRows("a/b/c/d/e/f/g.ts"), [
      { kind: "folder", label: "a/b" },
      { kind: "folder", label: "c" },
      { kind: "folder", label: "d" },
      { kind: "folder", label: "e" },
      { kind: "folder", label: "f" },
      { kind: "file", label: "g.ts" },
    ]);
  });

  test("draws nothing for a path with no segments", () => {
    assert.deepEqual(mentionPreviewRows("/"), []);
  });
});
