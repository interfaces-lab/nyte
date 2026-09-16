import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

describe("Sparkle packaging boundary", () => {
  test("production has the release public key without environment setup", () => {
    const result = packaging();
    expect(result.status, result.stderr).toBe(0);
    const config: unknown = JSON.parse(result.stdout);
    expect(config).toHaveProperty(
      "mac.extendInfo.SUPublicEDKey",
      "u6NmdrN0PD5XXdy2KJyUfyvzB3hCtI3+6Gf1bg8IYDc=",
    );
  });

  test("local builds cannot fall back to the production key", () => {
    expect(packaging({ local: "1" }).status).not.toBe(0);
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

  test("Linux and Windows executables do not inherit the scoped package name", () => {
    const result = packaging({ platform: "linux" });
    expect(result.status, result.stderr).toBe(0);
    const config: unknown = JSON.parse(result.stdout);
    expect(config).toMatchObject({
      executableName: "Nyte",
      extraMetadata: { name: "Nyte" },
      linux: { desktopName: "Nyte", executableName: "Nyte" },
      win: { executableName: "Nyte" },
    });
  });

  test("production uses the stable GitHub feed and keeps Apple signing enabled", () => {
    const result = packaging({ key: publicKey });
    expect(result.status, result.stderr).toBe(0);
    const config: unknown = JSON.parse(result.stdout);
    expect(config).toMatchObject({
      appId: "ai.nyte.desktop",
      productName: "Nyte",
      executableName: "Nyte",
      extraMetadata: { name: "Nyte", productName: "Nyte" },
      linux: { desktopName: "Nyte", executableName: "Nyte" },
      win: { executableName: "Nyte" },
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
    expect(config).toMatchObject({
      appId: "ai.nyte.desktop.update-test",
      productName: "Nyte Update Test",
      executableName: "Nyte Update Test",
      extraMetadata: { name: "Nyte Update Test", productName: "Nyte Update Test" },
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
