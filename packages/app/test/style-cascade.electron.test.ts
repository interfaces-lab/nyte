import { expect, test } from "vitest";
import { testRenderer } from "./renderer.ts";

test(
  "the style cascade orders UA, base, component, and app rules, and every appearance input reaches its tokens",
  { timeout: 90_000 },
  async () => {
    expect(await testRenderer(new URL("./style-cascade.browser-test.tsx", import.meta.url))).toBe(
      "passed",
    );
  },
);
