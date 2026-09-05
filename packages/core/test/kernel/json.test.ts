/** The JSON boundary and content addressing, by value. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { hashObject } from "../../src/kernel/hash.ts";
import { canonicalJson, toJsonValue } from "../../src/kernel/json.ts";

interface CyclicValue {
  self?: CyclicValue;
}

test("canonical JSON depends on content, not on key order or absent properties", () => {
  assert.equal(
    canonicalJson({ b: [{ z: 1, y: 2 }], a: undefined, c: "x" }),
    canonicalJson({ c: "x", b: [{ y: 2, z: 1 }] }),
  );
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.equal(canonicalJson({ b: 1, a: null }), '{"a":null,"b":1}');
  assert.throws(() => canonicalJson(undefined), TypeError);
});

test("an object's id follows its content", () => {
  const left = hashObject({ kind: "blob", value: { a: 1, b: 2 } });
  assert.equal(left, hashObject({ kind: "blob", value: { b: 2, a: 1 } }));
  assert.notEqual(left, hashObject({ kind: "blob", value: { a: 1, b: 3 } }));
  assert.match(left, /^[0-9a-f]{64}$/u);
});

test("toJsonValue admits exactly what JSON can round-trip", () => {
  assert.deepEqual(toJsonValue({ a: [1, "x", null, { b: true }], c: undefined }), {
    a: [1, "x", null, { b: true }],
  });
  const cyclic: CyclicValue = {};
  cyclic.self = cyclic;
  class Thing {
    value = 1;
  }
  const rejected: unknown[] = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -0,
    cyclic,
    new Thing(),
    new Map(),
    { [Symbol("s")]: 1 },
    () => 1,
    undefined,
    [undefined],
  ];
  for (const value of rejected) {
    assert.throws(() => toJsonValue(value), TypeError);
  }
});
