import { request } from "node:http";
import { CHANNEL_HEADER, CHANNEL_PATH, parseSse, STREAM_HEADER } from "@nyte-ai/protocol";
import { afterEach, assert, expect, it } from "vitest";
import { fakeModels, simulate } from "../../src/index.ts";
import { folder, removeFolders } from "./support.ts";

afterEach(removeFolders);

function postLate(url: URL, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const posted = request(url, { method: "POST", headers, agent: false }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });

    posted.on("error", reject);
    posted.flushHeaders();
    setTimeout(() => posted.end(body), 50);
  });
}

it("serves a shared stream whose request body arrives after its headers", async () => {
  const fake = fakeModels();
  const workspace = await folder();
  await using simulation = await simulate({ models: fake.models, home: await folder(), workspace });
  const { host } = simulation;
  const token = "perturbation-token";

  await using listener = await host.listen({
    transport: { kind: "http", hostname: "127.0.0.1" },
    auth: { kind: "token", token },
  });

  assert(listener.address !== null);
  const { session } = await host.sessions.start({ content: "Hi." });
  const authorization = `Bearer ${token}`;

  const opened = await fetch(`${listener.address}/${CHANNEL_PATH}`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: "{}",
  });

  const channel = opened.headers.get(CHANNEL_HEADER);

  assert(channel !== null && opened.body !== null);
  const stream = crypto.randomUUID();

  const status = await postLate(
    new URL(`${listener.address}/head.watch`),
    {
      authorization,
      "content-type": "application/json",
      [CHANNEL_HEADER]: channel,
      [STREAM_HEADER]: stream,
    },
    JSON.stringify({ session: session.id, head: "main" }),
  );

  expect(status).toBe(202);

  const frames = parseSse(opened.body);

  const first = await Promise.race([
    (async () => {
      for await (const frame of frames) return frame;

      return null;
    })(),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3_000)),
  ]);

  expect(first).toMatchObject({ kind: "chunk", stream });
  await frames.return(undefined);
});
