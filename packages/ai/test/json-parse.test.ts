import assert from "node:assert/strict";
import { test } from "vitest";
import { parseStreamingJson } from "../src/utils/json-parse.ts";

test("streaming arguments retain nested JSON values and recover unfinished objects", () => {
  assert.deepEqual(parseStreamingJson('{"path":"a","options":{"lines":[1,true,null]}}'), {
    path: "a",
    options: { lines: [1, true, null] },
  });
  assert.deepEqual(parseStreamingJson('{"path":"a"'), { path: "a" });
  assert.deepEqual(parseStreamingJson('{"path":"a\nb"}'), { path: "a\nb" });
  assert.deepEqual(parseStreamingJson('{"path":"a\nb"'), { path: "a\nb" });
});

test.each([undefined, "", " ", "null", "[]", "42", "true", '"text"', "not json"])(
  "streaming arguments keep an object shape for input %s",
  (input) => {
    assert.deepEqual(parseStreamingJson(input), {});
  },
);
