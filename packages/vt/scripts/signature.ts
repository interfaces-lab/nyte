import { createHash, createPublicKey, verify } from "node:crypto";

const ghosttyPublicKey = "RWQlAjJC23149WL2sEpT/l0QKy7hMIFhYdQOFy0Z7z7PbneUgvlsnYcV";

export function verifySignature(
  file: Uint8Array,
  minisig: string,
  publicKey = ghosttyPublicKey,
): string {
  const key = Buffer.from(publicKey, "base64");
  const lines = minisig.split("\n");
  const signature = Buffer.from(lines[1] ?? "", "base64");
  const trustedComment = (lines[2] ?? "").replace(/^trusted comment: /u, "");
  const globalSignature = Buffer.from(lines[3] ?? "", "base64");
  const algorithm = signature.subarray(0, 2).toString();

  if (key.length !== 42 || signature.length !== 74 || globalSignature.length !== 64) {
    throw new Error("malformed minisign key or signature");
  }

  if (!signature.subarray(2, 10).equals(key.subarray(2, 10))) {
    throw new Error("signature was made with a different key");
  }

  if (algorithm !== "ED") throw new Error(`unsupported minisign algorithm ${algorithm}`);

  const verifier = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: key.subarray(10).toString("base64url") },
    format: "jwk",
  });

  if (
    !verify(null, createHash("blake2b512").update(file).digest(), verifier, signature.subarray(10))
  ) {
    throw new Error("file signature does not verify");
  }

  if (
    !verify(
      null,
      Buffer.concat([signature.subarray(10), Buffer.from(trustedComment)]),
      verifier,
      globalSignature,
    )
  ) {
    throw new Error("trusted comment signature does not verify");
  }

  return trustedComment;
}
