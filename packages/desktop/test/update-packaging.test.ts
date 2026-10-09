import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, test } from "vitest";

const desktop = fileURLToPath(new URL("../", import.meta.url));

function packaging({ local = "" }: { local?: string } = {}) {
  return spawnSync(process.execPath, ["--input-type=module"], {
    cwd: desktop,
    encoding: "utf8",
    env: { ...process.env, NYTE_UPDATE_TEST: local },
    input: `import config from './electron-builder.config.ts';
      console.log(JSON.stringify(config));`,
  });
}

const Names = Type.Object({
  productName: Type.String(),
  executableName: Type.String(),
  extraMetadata: Type.Object({ name: Type.String(), productName: Type.String() }),
  linux: Type.Object({ executableName: Type.String() }),
  win: Type.Object({ executableName: Type.String() }),
});

/** The product name, once every installer names its executable after it and none inherits the `@scope/` package name. */
function installerName(stdout: string): string {
  const names = Value.Parse(Names, JSON.parse(stdout));
  expect(names.productName).toMatch(/^[A-Za-z][A-Za-z0-9 ]*$/u);
  expect([
    names.executableName,
    names.extraMetadata.name,
    names.extraMetadata.productName,
    names.linux.executableName,
    names.win.executableName,
  ]).toEqual(Array.from({ length: 5 }, () => names.productName));

  return names.productName;
}

describe("update packaging", () => {
  test("production updates from GitHub releases with Apple signing enabled", () => {
    const result = packaging();
    expect(result.status, result.stderr).toBe(0);
    installerName(result.stdout);
    expect(JSON.parse(result.stdout)).toMatchObject({
      appId: "ai.nyte.desktop",
      publish: { provider: "github", owner: "interfaces-lab", repo: "nyte" },
      mac: { hardenedRuntime: true, forceCodeSigning: true },
    });
  });

  test("local packages persist a separate identity and update from localhost", () => {
    const result = packaging({ local: "1" });
    expect(result.status, result.stderr).toBe(0);
    // A shared product name would install the test build over the real app.
    expect(installerName(result.stdout)).not.toBe(installerName(packaging().stdout));
    expect(JSON.parse(result.stdout)).toMatchObject({
      appId: "ai.nyte.desktop.update-test",
      publish: { provider: "generic", url: "http://localhost:8917" },
      mac: { notarize: false },
    });
  });
});
