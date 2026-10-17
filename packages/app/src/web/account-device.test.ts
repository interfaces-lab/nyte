import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDeviceSecret } from "@nyte-ai/connect/enrollment";
import {
  accountConnection,
  deviceCrypto,
  forgetAccountDevice,
  loadAccountDevice,
  readClientId,
  saveAccountDevice,
} from "./account-device.ts";

const config = {
  publishableKey: `pk_test_${btoa("clerk.example.com$")}`,
  origin: "https://connect.example.com",
};

function storage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const device = {
  origin: config.origin,
  ownerId: "user_one",
  environmentId: "c87081d0-9697-40b7-98bd-7f655e6013ea",
  deviceId: "3e347db5-c0f2-4a8e-a1f9-7d19b77f0536",
  name: "Desktop",
  token: "A".repeat(43),
  role: "controller" as const,
};

describe("browser device", () => {
  it("makes a 256-bit bearer and hashes its UTF-8 string, not its random bytes", async () => {
    const secret = await createDeviceSecret(deviceCrypto);
    const next = await createDeviceSecret(deviceCrypto);
    expect(secret.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(secret.token, "base64url")).toHaveLength(32);
    expect(secret.digest).toBe(
      createHash("sha256").update(secret.token, "utf8").digest("base64url"),
    );
    expect(next.token).not.toBe(secret.token);
  });

  it("resumes in the same tab and forgets on removal or a new tab", () => {
    const tab = storage();
    saveAccountDevice(tab, device);
    const resumed = loadAccountDevice(tab, config, device.ownerId);
    expect(resumed).toEqual(device);
    expect(accountConnection(device)).toEqual({
      url: `${config.origin}/r/${device.environmentId}`,
      token: device.token,
    });
    expect(loadAccountDevice(storage(), config, device.ownerId)).toBeUndefined();
    forgetAccountDevice(tab);
    expect(loadAccountDevice(tab, config, device.ownerId)).toBeUndefined();
  });

  it("never resumes credentials for another owner, broker, or invalid payload", () => {
    const tab = storage();
    saveAccountDevice(tab, device);
    expect(loadAccountDevice(tab, config, "user_two")).toBeUndefined();
    expect(
      loadAccountDevice(tab, { ...config, origin: "https://another.example.com" }, device.ownerId),
    ).toBeUndefined();
    saveAccountDevice(tab, { ...device, token: "invalid" });
    expect(loadAccountDevice(tab, config, device.ownerId)).toBeUndefined();
    tab.setItem("nyte:account:device", "{broken");
    expect(loadAccountDevice(tab, config, device.ownerId)).toBeUndefined();
  });

  it("keeps a stable owner-scoped client ID without making tabs replace each other", () => {
    const tab = storage();
    const first = readClientId(tab, "user_one");
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(readClientId(tab, "user_one")).toBe(first);
    expect(readClientId(tab, "user_two")).not.toBe(first);
    expect(readClientId(storage(), "user_one")).not.toBe(first);
  });
});
