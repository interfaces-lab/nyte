import { describe, expect, it } from "vitest";
import {
  base64ToBase64Url,
  base64Url,
  fromBase64Url,
  isRelayAddress,
  relayAddress,
} from "../src/index.ts";

const origin = "https://connect.example.com";
const environmentId = "3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f";

const standard = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe("base64Url", () => {
  it("matches the platform encoder for every remainder, and decodes back", () => {
    for (const length of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);

      expect(base64Url(bytes)).toBe(base64ToBase64Url(standard(bytes)));
      expect(fromBase64Url(base64Url(bytes))).toEqual(bytes);
    }
  });

  it.each(["A", "AA==", "AB+/", "AA A", "AB"])("refuses %s", (text) => {
    expect(fromBase64Url(text)).toBeUndefined();
  });
});

describe("relay addresses", () => {
  it("puts the environment under the origin's relay prefix", () => {
    const address = relayAddress(origin, environmentId);

    expect(address).toBe(`${origin}/r/${environmentId}`);
    expect(isRelayAddress(address, origin)).toBe(true);
  });

  it.each([
    `https://other.example.com/r/${environmentId}`,
    `${origin}/r/${environmentId}/`,
    `${origin}/r/${environmentId}/v1`,
    `${origin}/r/${environmentId.toUpperCase()}`,
    `${origin}/r/../${environmentId}`,
    `${origin}/x/${environmentId}`,
  ])("refuses %s", (address) => {
    expect(isRelayAddress(address, origin)).toBe(false);
  });

  it("refuses an origin or id it would not derive from", () => {
    expect(() => relayAddress("http://connect.example.com", environmentId)).toThrow();
    expect(() => relayAddress(origin, "../x")).toThrow();
  });
});
