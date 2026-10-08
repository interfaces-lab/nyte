import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, test } from "vitest";

const desktop = fileURLToPath(new URL("../", import.meta.url));

const publicKey = Buffer.alloc(32, 1).toString("base64");

function packaging({
  platform = "darwin",
  key,
  local = "",
}: { platform?: string; key?: string; local?: string } = {}) {
  return spawnSync(process.execPath, ["--input-type=module"], {
    cwd: desktop,
    encoding: "utf8",
    env: {
      ...process.env,
      NYTE_SPARKLE_PUBLIC_KEY: key,
      NYTE_UPDATE_TEST: local,
      TEST_PLATFORM: platform,
    },
    input: `import config from './electron-builder.config.ts';
      await config.beforePack({ electronPlatformName: process.env.TEST_PLATFORM });
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

describe("Sparkle packaging boundary", () => {
  test("local builds cannot fall back to the production key", () => {
    const result = packaging({ local: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NYTE_SPARKLE_PUBLIC_KEY");
  });

  test("macOS cannot ship an updater without a valid public key", () => {
    for (const key of ["", "not-a-key", Buffer.alloc(64).toString("base64")]) {
      const result = packaging({ key });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("NYTE_SPARKLE_PUBLIC_KEY");
    }
  });

  test("Windows and Linux packaging do not require Sparkle credentials", () => {
    for (const platform of ["win32", "linux"]) expect(packaging({ platform }).status).toBe(0);
  });

  test("production uses the stable GitHub feed and keeps Apple signing enabled", () => {
    const result = packaging({ key: publicKey });
    expect(result.status, result.stderr).toBe(0);
    const config: unknown = JSON.parse(result.stdout);
    installerName(result.stdout);
    expect(config).toMatchObject({
      appId: "ai.nyte.desktop",
      mac: {
        hardenedRuntime: true,
        forceCodeSigning: true,
        extendInfo: {
          SUPublicEDKey: publicKey,
          SUFeedURL:
            "https://github.com/interfaces-lab/nyte/releases/download/desktop-updates/appcast.xml",
          SUEnableAutomaticChecks: false,
        },
      },
    });
    expect(config).not.toHaveProperty("mac.extendInfo.NSAppTransportSecurity");
    expect(config).not.toHaveProperty("mac.identity");
  });

  test("local packages persist a separate identity and explicitly permit only local networking", () => {
    const result = packaging({ key: publicKey, local: "1" });
    expect(result.status, result.stderr).toBe(0);
    const config: unknown = JSON.parse(result.stdout);
    // A shared product name would install the test build over the real app.
    expect(installerName(result.stdout)).not.toBe(
      installerName(packaging({ key: publicKey }).stdout),
    );
    expect(config).toMatchObject({
      appId: "ai.nyte.desktop.update-test",
      mac: {
        identity: "-",
        notarize: false,
        extendInfo: {
          SUPublicEDKey: publicKey,
          SUFeedURL: "http://localhost:8917/appcast.xml",
          NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
        },
      },
    });
    expect(config).not.toHaveProperty(
      "mac.extendInfo.NSAppTransportSecurity.NSAllowsArbitraryLoads",
    );
  });
});
