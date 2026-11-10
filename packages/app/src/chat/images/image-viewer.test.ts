import { mkdir } from "node:fs/promises";
import { expect, test } from "vitest";
import { testRenderer } from "../../../test/renderer.ts";

const captures = process.env.NYTE_IMAGE_CAPTURE;

test("a failed composer image read leaves the viewer open with its marks and an error alert, and unmounting cancels pending flattening and delivery without a late Add to Chat", async () => {
  if (captures !== undefined) await mkdir(captures, { recursive: true });
  expect(
    await testRenderer(new URL("./image-viewer.browser-test.tsx", import.meta.url), "", {
      captures,
    }),
  ).toBe("passed");
}, 60_000);
