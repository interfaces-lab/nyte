import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { verifySignature } from "../scripts/signature.ts";

const wasm = await readFile(new URL("../ghostty-vt.wasm", import.meta.url));

const minisig = await readFile(new URL("../ghostty-vt.wasm.minisig", import.meta.url), "utf8");

const pin: unknown = JSON.parse(await readFile(new URL("../pin.json", import.meta.url), "utf8"));

describe("provenance", () => {
  test("the committed wasm matches pin.json", () => {
    expect(pin).toMatchObject({ sha256: createHash("sha256").update(wasm).digest("hex") });
  });

  test("Ghostty's key signed the committed wasm", () => {
    expect(verifySignature(wasm, minisig)).toContain("file:ghostty-vt.wasm");
  });

  test("a modified byte fails verification", () => {
    const tampered = Uint8Array.from(wasm);

    tampered[tampered.length >> 1] ^= 0x01;
    expect(() => verifySignature(tampered, minisig)).toThrow("file signature does not verify");
  });

  test("a changed trusted comment fails verification", () => {
    const relabeled = minisig.replace("file:ghostty-vt.wasm", "file:other.wasm");

    expect(() => verifySignature(wasm, relabeled)).toThrow(
      "trusted comment signature does not verify",
    );
  });
});
