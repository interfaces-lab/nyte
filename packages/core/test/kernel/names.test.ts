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
  isDelivery,
  isRefName,
  keyRef,
  parseInboxRef,
  inboxBaseRef,
  inboxPrefix,
  inboxTipRef,
  runRef,
  stackRef,
} from "../../src/kernel/names.ts";

test("every ref family has its documented place", () => {
  assert.equal(headRef("main"), "refs/heads/main");
  assert.equal(stackRef("review"), "refs/stacks/review");
  assert.equal(inboxTipRef("main", "steer"), "refs/inbox/main/steer/tip");
  assert.equal(inboxBaseRef("main", "next"), "refs/inbox/main/next/base");
  assert.ok(inboxTipRef("main", "steer").startsWith(inboxPrefix("main")));
  assert.equal(inboxTipRef("main-2", "next").startsWith(inboxPrefix("main")), false);
  assert.deepEqual(parseInboxRef("refs/inbox/main/next/base"), {
    head: "main",
    delivery: "next",
    position: "base",
  });
  for (const name of [
    "refs/inbox/main/next",
    "refs/inbox/main/next/middle",
    "refs/inbox/main//tip",
    "refs/inbox/a/b/c/tip",
    "refs/heads/main",
  ]) {
    assert.equal(parseInboxRef(name), undefined, name);
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
    "refs/inbox/main/steer/tip",
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
  assert.equal(isDelivery("steer"), true);
  assert.equal(isDelivery("next"), true);
  assert.equal(isDelivery("urgent"), false);
  assert.equal(isDelivery(""), false);
});
