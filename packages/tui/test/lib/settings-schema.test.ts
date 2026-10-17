import { expect, test } from "bun:test";
import { parseSettingsFile } from "../../src/lib/settings-schema.ts";

test("the remembered thinking level parses only as a known level", () => {
  expect(parseSettingsFile({ thinkingLevel: "high", other: 1 })).toEqual({ thinkingLevel: "high" });
  expect(() => parseSettingsFile({ thinkingLevel: "huge" }, "settings.json")).toThrow(
    "settings.json.thinkingLevel must be one of: off, minimal, low, medium, high, xhigh, max",
  );
});
