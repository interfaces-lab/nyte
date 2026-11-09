import { describe, expect, test } from "vitest";

import { loadEngine } from "../src/index.ts";

describe("loadEngine", () => {
  test("names a missing export", async () => {
    const empty = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    await expect(loadEngine(empty)).rejects.toThrow(
      "missing the function export ghostty_type_json",
    );
  });
});
