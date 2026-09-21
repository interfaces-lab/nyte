import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { createChangesCodeViewItems } from "./changes-stack-code-view.ts";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";

const patch = ["--- src/a.ts", "+++ src/a.ts", "@@ -1 +1 @@", "-old", "+new", ""].join("\n");

function diffItem(value: string): ChangesStackItem {
  return {
    kind: "diff",
    path: "src/a.ts",
    patch: value,
    added: 1,
    removed: 1,
  };
}

describe("changes CodeView items", () => {
  test("versions native updates while retaining a hydrated diff through collapse", () => {
    const store = createChangesCodeViewItems();
    const first = store([diffItem(patch)], []).items[0];
    assert.ok(first);
    assert.equal(first.type, "diff");
    first.fileDiff.isPartial = false;

    const collapsed = store([diffItem(patch)], ["src/a.ts"]).items[0];
    assert.ok(collapsed);
    assert.equal(collapsed.type, "diff");
    assert.notEqual(collapsed.version, first.version);
    assert.equal(collapsed.collapsed, true);
    assert.strictEqual(collapsed.fileDiff, first.fileDiff);
    assert.equal(collapsed.fileDiff.isPartial, false);

    const expanded = store([diffItem(patch)], []).items[0];
    assert.ok(expanded);
    assert.equal(expanded.type, "diff");
    assert.notEqual(expanded.version, collapsed.version);
    assert.strictEqual(expanded.fileDiff, first.fileDiff);

    const refreshed = store([diffItem(patch.replace("+new", "+newer"))], []).items[0];
    assert.ok(refreshed);
    assert.equal(refreshed.type, "diff");
    assert.notEqual(refreshed.version, expanded.version);
    assert.notStrictEqual(refreshed.fileDiff, first.fileDiff);
    assert.match(refreshed.fileDiff.additionLines.join(""), /newer/);
  });

  test("keeps every file entry when one patch repeats a path", () => {
    const model = createChangesCodeViewItems()([diffItem(`${patch}\n${patch}`)], []);

    assert.equal(model.items.length, 2);
    assert.notEqual(model.items[0]?.id, model.items[1]?.id);
  });

  test("uses a native file item when Pierre cannot parse a patch", () => {
    const raw = "this is not a patch";
    const item = createChangesCodeViewItems()([diffItem(raw)], []).items[0];

    assert.ok(item);
    assert.equal(item.type, "file");
    assert.equal(item.file.contents, raw);
  });
});
