/**
 * The environment call against a scripted `fetch`: the route and envelope it
 * sends, and a reply checked against that operation's own output schema.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createNyteClient, NyteTransportError } from "../src/index.ts";

test("an environment call posts to its wire name and checks the reply against that operation", async () => {
  const sent: Request[] = [];
  const client = createNyteClient({
    baseUrl: "http://h.test",
    fetch: async (input, init) => {
      sent.push(new Request(input, init));

      return new Response(JSON.stringify({ ok: true, defined: true, value: { kind: "unknown" } }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(await client.environment("environment.loginAttempt", { attempt: "a1" }), {
    kind: "unknown",
  });
  await assert.rejects(
    client.environment("environment.github.state", undefined),
    (error) => error instanceof NyteTransportError && error.failure.kind === "bad_body",
  );
  assert.deepEqual(
    await Promise.all(sent.map(async (request) => [request.url, await request.text()])),
    [
      ["http://h.test/v1/call/environment.loginAttempt", '{"input":{"attempt":"a1"}}'],
      ["http://h.test/v1/call/environment.github.state", "{}"],
    ],
  );
});

test("a GitHub reply whose links leave github.com is refused before the client can open them", async () => {
  const answers: unknown[] = [
    { kind: "created", url: "https://github.com/owner/repo/pull/13" },
    { kind: "created", url: "https://evil.test/owner/repo/pull/13" },
    { kind: "created", url: "javascript:alert(1)" },
    {
      kind: "ready",
      repository: { owner: "o", name: "r", remoteName: "origin", url: "http://github.com/o/r" },
      account: { login: "octocat" },
      pullRequest: { kind: "none" },
    },
  ];
  const client = createNyteClient({
    baseUrl: "http://h.test",
    fetch: async () =>
      new Response(JSON.stringify({ ok: true, defined: true, value: answers.shift() }), {
        headers: { "content-type": "application/json" },
      }),
  });

  assert.deepEqual(
    await client.environment("environment.github.createPullRequest", { title: "feat: ship" }),
    { kind: "created", url: "https://github.com/owner/repo/pull/13" },
  );

  for (const call of [
    () => client.environment("environment.github.createPullRequest", { title: "feat: ship" }),
    () => client.environment("environment.github.createPullRequest", { title: "feat: ship" }),
    () => client.environment("environment.github.state", undefined),
  ]) {
    await assert.rejects(
      call(),
      (error) => error instanceof NyteTransportError && error.failure.kind === "bad_body",
    );
  }
});
