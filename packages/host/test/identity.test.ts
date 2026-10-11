import { asId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { identitySigner } from "../src/identity.ts";

const secrets = { key: async () => new Uint8Array(32).fill(7) };

describe("identitySigner", () => {
  it("signs nyte/identity, the host id and the nonce with a key the public key verifies", async () => {
    const signer = await identitySigner(asId("host-1"), secrets);
    const challenge = await signer.sign("n1");

    expect(signer.id).toBe("host-1");
    expect([challenge.hostId, challenge.nonce]).toEqual(["host-1", "n1"]);
    expect(challenge.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge.signature).toMatch(/^[A-Za-z0-9_-]{86}$/);

    const publicKey = await crypto.subtle.importKey(
      "raw",
      Uint8Array.fromBase64(challenge.publicKey, { alphabet: "base64url" }),
      "Ed25519",
      false,
      ["verify"],
    );

    const signature = Uint8Array.fromBase64(challenge.signature, { alphabet: "base64url" });
    const signed = (text: string) => new TextEncoder().encode(text);

    expect(
      await crypto.subtle.verify(
        "Ed25519",
        publicKey,
        signature,
        signed("nyte/identity\nhost-1\nn1"),
      ),
    ).toBe(true);
    expect(
      await crypto.subtle.verify(
        "Ed25519",
        publicKey,
        signature,
        signed("nyte/identity\nhost-2\nn1"),
      ),
    ).toBe(false);
  });

  it("derives one key pair from one secrets key, another from another, and refuses a short key", async () => {
    const [one, two] = await Promise.all([
      identitySigner(asId("a"), secrets),
      identitySigner(asId("b"), secrets),
    ]);

    const other = await identitySigner(asId("a"), { key: async () => new Uint8Array(32).fill(8) });

    expect((await one.sign("x")).publicKey).toBe((await two.sign("x")).publicKey);
    expect((await other.sign("x")).publicKey).not.toBe((await one.sign("x")).publicKey);
    await expect(
      identitySigner(asId("a"), { key: async () => new Uint8Array(10) }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
