import { ErrorBody } from "@nyte-ai/connect";
import { generateKeyPair } from "jose";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AZP, ORIGIN, createHarness } from "./harness.ts";
import type { Harness } from "./harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.dispose();
});

beforeEach(async () => {
  await harness.reset();
});

const list = async (token: string) => {
  const answer = await harness.send({
    method: "GET",
    path: "/v1/environments",
    headers: { authorization: `Bearer ${token}` },
  });

  return {
    status: answer.status,
    code: Value.Check(ErrorBody, answer.body) ? answer.body.error.code : undefined,
  };
};

describe("Clerk session verification", () => {
  it("accepts a standard session token with or without an allowed azp", async () => {
    expect((await list(await harness.sessionToken({ userId: "user_alice" }))).status).toBe(200);
    expect(
      (await list(await harness.sessionToken({ userId: "user_alice", claims: { azp: AZP } })))
        .status,
    ).toBe(200);
    expect(
      (
        await list(
          await harness.sessionToken({
            userId: "user_alice",
            claims: { aud: ["https://other.example", ORIGIN] },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it.each([
    ["a wrong issuer", { claims: { iss: "https://clerk.attacker.example" } }],
    ["a missing audience", { omit: ["aud"] }],
    ["another audience", { claims: { aud: "https://other.example" } }],
    ["a missing session id", { omit: ["sid"] }],
    ["an empty session id", { claims: { sid: "" } }],
    ["a pending session", { claims: { sts: "pending" } }],
    ["an impersonation actor", { claims: { act: { sub: "user_admin" } } }],
    ["a null actor", { claims: { act: null } }],
    ["an unlisted azp", { claims: { azp: "https://evil.example" } }],
    ["an expired token", { claims: { exp: Math.floor(Date.now() / 1000) - 120 } }],
    ["a future token", { claims: { nbf: Math.floor(Date.now() / 1000) + 600 } }],
  ])("refuses %s", async (_label, input) => {
    expect(await list(await harness.sessionToken({ userId: "user_alice", ...input }))).toEqual({
      status: 401,
      code: "unauthorized",
    });
  });

  it("refuses a token signed by another key and a malformed bearer", async () => {
    const other = await generateKeyPair("RS256", { modulusLength: 2048 });

    expect(
      (await list(await harness.sessionToken({ userId: "user_alice", key: other.privateKey })))
        .status,
    ).toBe(401);
    expect((await list("not-a-jwt")).status).toBe(401);
    const missing = await harness.send({ method: "GET", path: "/v1/environments" });

    expect(missing.status).toBe(401);
  });

  it("refuses a banned owner and a denied session", async () => {
    await harness.db
      .prepare(
        "INSERT INTO owners (user_id, status, version) VALUES ('user_banned', 'disabled', 1)",
      )
      .run();
    await harness.db
      .prepare(
        "INSERT INTO denied_sessions (session_id, user_id, denied_at, next_attempt_at) VALUES ('sess_denied', 'user_alice', 0, 0)",
      )
      .run();

    expect(await list(await harness.sessionToken({ userId: "user_banned" }))).toEqual({
      status: 403,
      code: "owner_disabled",
    });
    expect(
      await list(await harness.sessionToken({ userId: "user_alice", sessionId: "sess_denied" })),
    ).toEqual({
      status: 401,
      code: "session_revoked",
    });
    expect(
      (await list(await harness.sessionToken({ userId: "user_alice", sessionId: "sess_other" })))
        .status,
    ).toBe(200);
  });

  it("serves the broker key set and fails closed on bad configuration", async () => {
    const keys = await harness.send({ method: "GET", path: "/.well-known/jwks.json" });

    expect(keys.status).toBe(200);
    expect(keys.body).toEqual(harness.brokerKeys);
    expect(keys.text).not.toContain('"d"');
    const unknown = await harness.send({ method: "GET", path: "/v1/elsewhere" });

    expect(unknown.status).toBe(404);
  });
});
