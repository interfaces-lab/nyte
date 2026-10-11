import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import { afterEach, describe, expect, it } from "vitest";
import { seedSigner } from "../src/identity.ts";
import { identitySigner } from "../src/identity-key.ts";

const seed = new Uint8Array(32).fill(7);

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await realpath(await mkdtemp(join(tmpdir(), "nyte-identity-")));
  folders.push(made);

  return made;
}

describe("seedSigner", () => {
  it("signs nyte/identity, the host id and the nonce with a key the public key verifies", async () => {
    const signer = await seedSigner(asId("host-1"), seed);
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

  it("keeps one key pair per seed, another for another, and refuses a short seed", async () => {
    const [one, two] = await Promise.all([
      seedSigner(asId("a"), seed),
      seedSigner(asId("b"), seed),
    ]);

    const other = await seedSigner(asId("a"), new Uint8Array(32).fill(8));

    expect((await one.sign("x")).publicKey).toBe((await two.sign("x")).publicKey);
    expect((await other.sign("x")).publicKey).not.toBe((await one.sign("x")).publicKey);
    await expect(seedSigner(asId("a"), new Uint8Array(10))).rejects.toMatchObject({
      code: "invalid",
    });
  });
});

describe("identitySigner", () => {
  it("mints <home>/.nyte/identity.key 0600 once and signs with it on every later open", async () => {
    const home = await folder();
    const first = await identitySigner(asId("a"), home);
    const path = join(home, ".nyte", "identity.key");
    const stored = new Uint8Array(await readFile(path));

    expect(stored).toHaveLength(32);
    expect((await first.sign("x")).publicKey).toBe(
      (await (await seedSigner(asId("a"), stored)).sign("x")).publicKey,
    );
    expect((await (await identitySigner(asId("a"), home)).sign("x")).publicKey).toBe(
      (await first.sign("x")).publicKey,
    );

    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);

    const short = await folder();
    await mkdir(join(short, ".nyte"));
    await writeFile(join(short, ".nyte", "identity.key"), new Uint8Array(10));

    await expect(identitySigner(asId("a"), short)).rejects.toMatchObject({ code: "invalid" });
  });
});
