import { EnvironmentList, ErrorBody, LinkResponse } from "@nyte-ai/connect";
import { keyThumbprint } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, read } from "./harness.ts";
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

const code = (body: unknown) => (Value.Check(ErrorBody, body) ? body.error.code : undefined);

describe("linking a desktop", () => {
  it("links the key and answers its environment, owner, and broker keys", async () => {
    const { answer, link, desktop } = await harness.link({ userId: "user_alice", name: "Studio" });

    expect(answer.status).toBe(201);
    expect(Value.Check(LinkResponse, answer.body)).toBe(true);
    expect(answer.body).toEqual({
      environment: { id: desktop.environmentId, name: "Studio" },
      owner: { id: "user_alice", label: "user_alice@example.com" },
      brokerKeys: harness.brokerKeys,
    });
    expect(link?.brokerKeys).toEqual(harness.brokerKeys);
    expect(await harness.rows("environments")).toEqual([
      expect.objectContaining({
        id: desktop.environmentId,
        owner_id: "user_alice",
        public_key: desktop.publicKey.x,
        state: "active",
        relay_session: null,
      }),
    ]);
  });

  it("labels the owner from Clerk, then a session email claim, then the user id", async () => {
    harness.clerkApi.users.set("user_named", {
      banned: false,
      locked: false,
      updated_at: 1,
      username: "nyte-fan",
    });
    expect((await harness.link({ userId: "user_named" })).link?.owner.label).toBe("nyte-fan");

    harness.clerkApi.userStatus = 503;
    expect((await harness.link({ userId: "user_offline" })).link?.owner).toEqual({
      id: "user_offline",
      label: "user_offline",
    });
    const desktop = await harness.newDesktop();
    const body = JSON.stringify({ publicKey: desktop.publicKey, name: "Mac" });
    const claimed = await harness.send({
      method: "POST",
      path: "/v1/environments",
      headers: {
        authorization: `Bearer ${await harness.sessionToken({
          userId: "user_claimed",
          claims: { email: "claimed@example.com" },
        })}`,
        "nyte-proof": await harness.proof({
          key: desktop.key,
          issuer: await keyThumbprint(desktop.publicKey),
          method: "POST",
          path: "/v1/environments",
          body,
        }),
      },
      body,
    });

    expect(read(claimed.body, "owner", "label")).toBe("claimed@example.com");
  });

  it("refuses a link for an owner Clerk reports banned, locked, or unknown", async () => {
    for (const [userId, user] of [
      ["user_banned", { banned: true, locked: false, updated_at: 1 }],
      ["user_locked", { banned: false, locked: true, updated_at: 1 }],
    ] as const) {
      harness.clerkApi.users.set(userId, { ...user });
      expect(read((await harness.link({ userId })).answer.body, "error", "code")).toBe(
        "owner_disabled",
      );
    }

    const desktop = await harness.newDesktop();
    const body = JSON.stringify({ publicKey: desktop.publicKey, name: "Mac" });
    const unknown = await harness.send({
      method: "POST",
      path: "/v1/environments",
      headers: {
        authorization: `Bearer ${await harness.sessionToken({ userId: "user_gone" })}`,
        "nyte-proof": await harness.proof({
          key: desktop.key,
          issuer: await keyThumbprint(desktop.publicKey),
          method: "POST",
          path: "/v1/environments",
          body,
        }),
      },
      body,
    });

    expect(read(unknown.body, "error", "code")).toBe("owner_disabled");
    expect(await harness.rows("environments")).toEqual([]);
  });

  it("refuses a link without a proof, with another key's proof, or with a replayed proof", async () => {
    harness.clerkApi.users.set("user_alice", { banned: false, locked: false, updated_at: 1 });
    const desktop = await harness.newDesktop();
    const other = await harness.newDesktop();
    const body = JSON.stringify({ publicKey: desktop.publicKey, name: "Mac" });
    const authorization = `Bearer ${await harness.sessionToken({ userId: "user_alice" })}`;
    const send = (proof?: string) =>
      harness.send({
        method: "POST",
        path: "/v1/environments",
        headers: proof === undefined ? { authorization } : { authorization, "nyte-proof": proof },
        body,
      });

    expect((await send()).status).toBe(401);
    const forged = await harness.proof({
      key: other.key,
      issuer: await keyThumbprint(desktop.publicKey),
      method: "POST",
      path: "/v1/environments",
      body,
    });

    expect((await send(forged)).status).toBe(401);
    const otherBody = await harness.proof({
      key: desktop.key,
      issuer: await keyThumbprint(desktop.publicKey),
      method: "POST",
      path: "/v1/environments",
      body: "{}",
    });

    expect((await send(otherBody)).status).toBe(401);
    const proof = await harness.proof({
      key: desktop.key,
      issuer: await keyThumbprint(desktop.publicKey),
      method: "POST",
      path: "/v1/environments",
      body,
    });

    expect((await send(proof)).status).toBe(201);
    expect((await send(proof)).status).toBe(401);
    expect(await harness.rows("environments")).toHaveLength(1);
  });

  it("resumes with the same key and refuses the key for another owner", async () => {
    const first = await harness.link({ userId: "user_alice" });
    const again = await harness.link({
      userId: "user_alice",
      desktop: first.desktop,
      name: "Renamed",
    });

    expect(again.answer.status).toBe(201);
    expect(again.link?.environment).toEqual({ id: first.link?.environment.id, name: "Renamed" });
    expect(await harness.rows("environments")).toHaveLength(1);

    const stolen = await harness.link({ userId: "user_mallory", desktop: first.desktop });

    expect(stolen.answer.status).toBe(409);
    expect(code(stolen.answer.body)).toBe("conflict");
  });

  it("holds an owner to three environments under concurrent links", async () => {
    const answers = await Promise.all(
      Array.from({ length: 6 }, () => harness.link({ userId: "user_alice" })),
    );
    const statuses = answers.map(({ answer }) => answer.status);

    expect(statuses.filter((status) => status === 201)).toHaveLength(3);
    expect(answers.filter(({ answer }) => code(answer.body) === "limit")).toHaveLength(3);
    expect(await harness.rows("environments")).toHaveLength(3);
    expect((await harness.link({ userId: "user_bob" })).answer.status).toBe(201);
  });

  it("lists only the caller's active environments", async () => {
    await harness.link({ userId: "user_alice", name: "Alice Mac" });
    await harness.link({ userId: "user_bob", name: "Bob Mac" });
    const answer = await harness.send({
      method: "GET",
      path: "/v1/environments",
      headers: { authorization: `Bearer ${await harness.sessionToken({ userId: "user_alice" })}` },
    });

    expect(answer.status).toBe(200);
    expect(Value.Check(EnvironmentList, answer.body)).toBe(true);
    expect(read(answer.body, "environments")).toEqual([
      expect.objectContaining({ name: "Alice Mac", online: false, lastSeenAt: null }),
    ]);
  });

  it("rejects an oversized body and malformed input", async () => {
    const authorization = `Bearer ${await harness.sessionToken({ userId: "user_alice" })}`;
    const huge = await harness.send({
      method: "POST",
      path: "/v1/environments",
      headers: { authorization },
      body: "x".repeat(20_000),
    });

    expect(huge.status).toBe(400);
    const desktop = await harness.newDesktop();
    const body = JSON.stringify({ publicKey: desktop.publicKey, name: "Mac", port: 4100 });
    const withPort = await harness.send({
      method: "POST",
      path: "/v1/environments",
      headers: {
        authorization,
        "nyte-proof": await harness.proof({
          key: desktop.key,
          issuer: await keyThumbprint(desktop.publicKey),
          method: "POST",
          path: "/v1/environments",
          body,
        }),
      },
      body,
    });

    expect(withPort.status).toBe(400);
    expect(await harness.rows("environments")).toEqual([]);
  });

  it("rate-limits links per owner", async () => {
    const statuses: number[] = [];

    for (let index = 0; index < 11; index += 1)
      statuses.push(
        (
          await harness.send({
            method: "POST",
            path: "/v1/environments",
            headers: {
              authorization: `Bearer ${await harness.sessionToken({ userId: "user_alice" })}`,
            },
            body: "{}",
          })
        ).status,
      );

    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
