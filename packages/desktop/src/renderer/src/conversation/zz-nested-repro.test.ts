import { test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

test("nested repro", { timeout: 120_000 }, async () => {
  const result = await testRenderer(
    new URL("./zz-nested-repro.browser-test.tsx", import.meta.url),
    "window.nyte = { host: { setThemePreference() {} } };",
  );
  console.log(`\nRESULT\n${result}\n`);
});
