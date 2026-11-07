import { isJsonObject, SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";

export async function sealText(
  kernel: Kernel,
  text: string,
): Promise<{ readonly iv: string; readonly ciphertext: string }> {
  const cipher = kernel.secretKey;

  if (cipher === null)
    throw new SdkError("unavailable", "This host has no secrets key, so it stores no secrets.");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const sealed = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await cipher,
      new TextEncoder().encode(text),
    ),
  );

  return { iv: iv.toBase64(), ciphertext: sealed.toBase64() };
}

export async function openText(
  kernel: Kernel,
  sealed: Json | undefined,
): Promise<string | undefined> {
  if (!isJsonObject(sealed)) return undefined;
  const iv = sealed.iv;
  const ciphertext = sealed.ciphertext;
  const cipher = kernel.secretKey;

  if (cipher === null || typeof iv !== "string" || typeof ciphertext !== "string") return undefined;

  const plain = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Uint8Array.fromBase64(iv) },
    await cipher,
    Uint8Array.fromBase64(ciphertext),
  );

  return new TextDecoder().decode(plain);
}

export function loadSecretCipherKey(source: NonNullable<Kernel["secrets"]>): Promise<CryptoKey> {
  return source.key().then((bytes) => {
    if (bytes.length !== 32)
      throw new SdkError("invalid", `The secrets key is ${bytes.length} bytes; AES-256 needs 32.`);

    return globalThis.crypto.subtle.importKey("raw", new Uint8Array(bytes), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  });
}
