import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";

const desktop = fileURLToPath(new URL("../", import.meta.url));

function packaging(build: string) {
  return spawnSync(process.execPath, ["--input-type=module"], {
    cwd: desktop,
    encoding: "utf8",
    env: { ...process.env, NYTE_DESKTOP_BUILD: build },
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

test("production updates signed from GitHub releases, and the update test build keeps a separate identity", () => {
  const names = new Set<string>();

  for (const row of [
    {
      build: "",
      expected: {
        appId: "ai.nyte.desktop",
        publish: { provider: "github", owner: "interfaces-lab", repo: "nyte" },
        mac: { hardenedRuntime: true, forceCodeSigning: true },
      },
    },
    {
      build: "Nyte Update Test",
      expected: {
        appId: "ai.nyte.desktop.update-test",
        publish: { provider: "generic", url: "http://localhost:8917" },
        mac: { notarize: false },
      },
    },
  ]) {
    const result = packaging(row.build);
    expect(result.status, result.stderr).toBe(0);
    names.add(installerName(result.stdout));
    expect(JSON.parse(result.stdout), `NYTE_DESKTOP_BUILD=${row.build}`).toMatchObject(
      row.expected,
    );
  }

  expect(names.size).toBe(2);
});
