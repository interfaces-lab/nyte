import assert from "node:assert/strict";
import { test } from "vitest";
import { createWorkGroupEntries } from "./work-group-entries.ts";

test("streamed suffixes do not read or copy historical entries", () => {
  let historyReads = 0;
  const settled = Array.from({ length: 10_000 }, (_, index) => ({
    get key() {
      historyReads += 1;
      return String(index);
    },
    text: "settled",
  }));
  const join = createWorkGroupEntries<{ readonly key: string; readonly text: string }>();
  const initial = join(settled, [{ key: "live", text: "first" }]);
  for (let frame = 0; frame < 100; frame += 1) {
    const next = join(settled, [{ key: "live", text: String(frame) }]);
    assert.equal(next.count, 10_001);
    assert.equal(next.at(10_000)?.text, String(frame));
    assert.equal(next.keyAt, initial.keyAt);
  }
  assert.equal(historyReads, 0);
  assert.equal(initial.at(10_000)?.text, "first");
  assert.equal(initial.at(20), settled[20]);
  assert.equal(initial.at(10_001), undefined);
});

test("key changes, removals and replaced durable prefixes invalidate the measurement key function", () => {
  const join = createWorkGroupEntries<{ readonly key: string }>();
  const settled = [{ key: "settled" }];
  const first = join(settled, [{ key: "live-a" }]);
  const replaced = join(settled, [{ key: "live-b" }]);
  assert.notEqual(replaced.keyAt, first.keyAt);
  assert.equal(first.keyAt(1), "live-a");
  assert.equal(replaced.keyAt(1), "live-b");
  const removed = join(settled, []);
  assert.equal(removed.count, 1);
  assert.equal(removed.at(1), undefined);
  const branched = join([{ key: "other" }], []);
  assert.equal(branched.keyAt(0), "other");
  assert.equal(first.keyAt(0), "settled");
});
