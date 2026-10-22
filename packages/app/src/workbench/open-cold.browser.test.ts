import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { testRenderer } from "../../test/renderer.ts";

test("New Terminal opens cold without its panel suspending", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-cold-panel-"));

  try {
    const modulePath = join(directory, "workbench.mjs");
    await writeFile(modulePath, "window.publishWorkbench();\n");
    expect(
      await testRenderer(
        new URL("./open-cold.browser-test.tsx", import.meta.url),
        `window.nyte = { clientSurface: "desktop", platform: "linux", host: {} };
window.workbenchModuleUrl = ${JSON.stringify(pathToFileURL(modulePath).href)};`,
      ),
    ).toBe("passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
