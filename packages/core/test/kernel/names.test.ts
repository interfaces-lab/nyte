/** The ref layout is a durable format, so it is asserted like one. */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  cancelledRef,
  effectPrefix,
  effectRef,
  factRef,
  parseHeadRef,
  headRef,
  isHeadName,
  isLaneName,
  isRefName,
  keyRef,
  parseQueueRef,
  queueBaseRef,
  queuePrefix,
  queueTipRef,
  runRef,
  stackRef,
} from "../../src/kernel/names.ts";

test("every ref family has its documented place", () => {
  assert.equal(headRef("main"), "refs/heads/main");
  assert.equal(stackRef("review"), "refs/stacks/review");
  assert.equal(queueTipRef("main", "steer"), "refs/queues/main/steer/tip");
  assert.equal(queueBaseRef("main", "queue"), "refs/queues/main/queue/base");
  assert.equal(queueTipRef("main", "anything-goes"), "refs/queues/main/anything-goes/tip");
  assert.ok(queueTipRef("main", "x").startsWith(queuePrefix("main")));
  assert.equal(queueTipRef("main-2", "x").startsWith(queuePrefix("main")), false);
  assert.deepEqual(parseQueueRef("refs/queues/main/urgent/base"), {
    head: "main",
    lane: "urgent",
    position: "base",
  });
  for (const name of [
    "refs/queues/main/urgent",
    "refs/queues/main/urgent/middle",
    "refs/queues/main//tip",
    "refs/queues/a/b/c/tip",
    "refs/heads/main",
  ]) {
    assert.equal(parseQueueRef(name), undefined, name);
  }
  assert.equal(runRef("main"), "refs/runs/main");
  assert.equal(effectRef("run_1", "call-2"), "refs/effects/run_1/call-2");
  assert.ok(effectRef("run_1", "call-2").startsWith(effectPrefix("run_1")));
  assert.equal(keyRef("k"), "refs/keys/k");
  assert.equal(factRef("name"), "refs/facts/name");
  assert.equal(cancelledRef("abc"), "refs/cancelled/abc");
  assert.equal(parseHeadRef(headRef("feature")), "feature");
  assert.equal(parseHeadRef("refs/stacks/feature"), undefined);
  assert.equal(parseHeadRef("refs/heads/"), undefined);
});

test("ref names follow git's rules", () => {
  for (const name of [
    "refs/heads/main",
    "refs/queues/main/steer/tip",
    "refs/effects/run_1/call-2",
  ]) {
    assert.equal(isRefName(name), true, name);
  }
  const backslash = String.fromCharCode(92);
  for (const name of [
    "",
    "a/",
    "a//b",
    "a..b",
    "a@{b",
    "a b",
    ".hidden",
    "x.lock",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    `a${backslash}b`,
    "a~b",
    "a^b",
    "a.",
    "@",
    `a${String.fromCharCode(7)}b`,
  ]) {
    assert.equal(isRefName(name), false, JSON.stringify(name));
  }
  assert.equal(isHeadName("review"), true);
  assert.equal(isHeadName("a/b"), false);
  assert.equal(isLaneName("urgent"), true);
  assert.equal(isLaneName("a/b"), false);
  assert.equal(isLaneName(""), false);
});
