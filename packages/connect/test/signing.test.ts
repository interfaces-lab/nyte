import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_LIFETIME_SECONDS,
  EnrollmentClaims,
  LEASE_LIFETIME_SECONDS,
  LeaseClaims,
  TOKEN_TYPES,
} from "../src/index.ts";
import {
  brokerKey,
  createProof,
  generateMachineKey,
  nowSeconds,
  publicKeyOf,
  publicKeySet,
  randomId,
  sha256,
  signClaims,
  verifyClaims,
  verifyProof,
} from "../src/signing.ts";

const origin = "https://connect.example.com";
const environmentId = "3f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f";

async function proofFor(body: string) {
  const key = await generateMachineKey();
  const token = await createProof({
    key,
    issuer: environmentId,
    audience: origin,
    method: "POST",
    path: `/v1/environments/${environmentId}/lease`,
    body,
  });

  return { key, token };
}

describe("request proofs", () => {
  it("verify for exactly the request they name", async () => {
    const { key, token } = await proofFor("{}");
    const claims = await verifyProof({
      token,
      key: publicKeyOf(key),
      issuer: environmentId,
      audience: origin,
      method: "POST",
      path: `/v1/environments/${environmentId}/lease`,
      body: "{}",
    });

    expect(claims.bh).toBe(await sha256("{}"));
  });

  it.each([
    ["another body", { body: '{"a":1}' }],
    ["another path", { path: `/v1/environments/${environmentId}/relay` }],
    ["another method", { method: "DELETE" as const }],
    ["another audience", { audience: "https://evil.example" }],
    ["another issuer", { issuer: "8f0c2a4e-8d2b-4c1a-9e3f-1a2b3c4d5e6f" }],
  ])("refuse %s", async (_, change) => {
    const { key, token } = await proofFor("{}");

    await expect(
      verifyProof({
        token,
        key: publicKeyOf(key),
        issuer: environmentId,
        audience: origin,
        method: "POST",
        path: `/v1/environments/${environmentId}/lease`,
        body: "{}",
        ...change,
      }),
    ).rejects.toThrow();
  });

  it("refuse another key and an expired proof", async () => {
    const { token } = await proofFor("{}");
    const other = await generateMachineKey();
    const base = {
      token,
      issuer: environmentId,
      audience: origin,
      method: "POST" as const,
      path: `/v1/environments/${environmentId}/lease`,
      body: "{}",
    };

    await expect(verifyProof({ ...base, key: publicKeyOf(other) })).rejects.toThrow();
    const { key, token: old } = await proofFor("{}");

    await expect(
      verifyProof({ ...base, token: old, key: publicKeyOf(key), now: Date.now() + 120_000 }),
    ).rejects.toThrow();
  });
});

describe("broker tokens", () => {
  it("pin typ and lifetime, and pick the key by kid", async () => {
    const signing = { ...(await generateMachineKey()), kid: "k1" };
    const keys = publicKeySet([signing]);
    const iat = nowSeconds();
    const lease = await signClaims({
      key: signing,
      typ: TOKEN_TYPES.lease,
      claims: {
        iss: origin,
        aud: environmentId,
        sub: "user_1",
        iat,
        exp: iat + LEASE_LIFETIME_SECONDS,
        req: randomId(),
        generation: 1,
        policy: 1,
        devices: [],
      },
    });
    const key = brokerKey(keys, lease);

    expect(key).toBeDefined();
    if (key === undefined) return;
    const verify = (typ: typeof TOKEN_TYPES.lease | typeof TOKEN_TYPES.enrollment) =>
      verifyClaims({
        token: lease,
        key,
        typ,
        issuer: origin,
        audience: environmentId,
        schema: LeaseClaims,
        lifetime: LEASE_LIFETIME_SECONDS,
      });

    expect((await verify(TOKEN_TYPES.lease)).generation).toBe(1);
    await expect(verify(TOKEN_TYPES.enrollment)).rejects.toThrow();

    const enrollment = async (lifetime: number) =>
      signClaims({
        key: signing,
        typ: TOKEN_TYPES.enrollment,
        claims: {
          iss: origin,
          aud: environmentId,
          sub: "user_1",
          iat,
          exp: iat + lifetime,
          jti: randomId(),
          nonce: randomId(),
          generation: 1,
          deviceId: environmentId,
          clientId: "client-0123456789ab",
          clientName: "Phone",
          digest: await sha256("t"),
        },
      });

    const verifyEnrollment = async (lifetime: number) =>
      verifyClaims({
        token: await enrollment(lifetime),
        key,
        typ: TOKEN_TYPES.enrollment,
        issuer: origin,
        audience: environmentId,
        schema: EnrollmentClaims,
        lifetime: ENROLLMENT_LIFETIME_SECONDS,
      });

    expect((await verifyEnrollment(ENROLLMENT_LIFETIME_SECONDS)).clientName).toBe("Phone");
    await expect(verifyEnrollment(ENROLLMENT_LIFETIME_SECONDS + 60)).rejects.toThrow(
      "Token lifetime exceeds the contract",
    );
  });
});
