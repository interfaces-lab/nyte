import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { testRenderer } from "../../../../test/renderer.ts";

const worker = createRequire(import.meta.url).resolve("pdfjs-dist/build/pdf.worker.min.mjs");

test("PDFs open, draw and close against the real pdf.js worker", { timeout: 120_000 }, async () => {
  expect(
    await testRenderer(
      new URL("./pdf.browser-test.tsx", import.meta.url),
      `window.pdfWorker = ${JSON.stringify(pathToFileURL(worker).href)};`,
    ),
  ).toBe("passed");
});
