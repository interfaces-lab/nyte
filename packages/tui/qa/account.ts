/**
 * The parties the account beat drives beside the binary: Nyte Connect
 * (`connect-broker.mjs`, under Node) and the owner's browser, which approves
 * the link at the page's broker routes and then enrolls as a device and calls
 * the host through the relay. The browser's requests cross the same HTTPS
 * front as the binary's and trust only this run's CA.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createNyteClient } from "@nyte-ai/client";
import type { NyteClient } from "@nyte-ai/client";
import {
  base64ToBase64Url,
  base64Url,
  createBrokerClient,
  DEVICE_TOKEN_BYTES,
  LinkTransactionLookup,
  relayAddress,
} from "@nyte-ai/connect";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";

const Ready = Compile(
  Type.Object({
    origin: Type.String(),
    ca: Type.String(),
    owner: Type.Object({ userId: Type.String(), email: Type.String() }),
  }),
);

const Answer = Compile(
  Type.Object({
    id: Type.Number(),
    value: Type.Optional(Type.Unknown()),
    error: Type.Optional(Type.String()),
  }),
);

const Token = Compile(Type.String({ minLength: 1 }));

const Rows = Compile(Type.Array(Type.Record(Type.String(), Type.Unknown())));

/** Starts Nyte Connect and resolves once its HTTPS front answers. */
export async function startConnect() {
  const child = Bun.spawn(
    ["node", fileURLToPath(new URL("./connect-broker.mjs", import.meta.url))],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  const waiting = new Map<number, (line: unknown) => void>();
  let buffered = "";
  let stderr = "";
  void new Response(child.stderr).text().then((text) => {
    stderr = text;
  });

  const lines = async function* () {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffered += decoder.decode(chunk.value, { stream: true });

      for (let end = buffered.indexOf("\n"); end !== -1; end = buffered.indexOf("\n")) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        yield line;
      }
    }
  };

  const incoming = lines();
  const first = await incoming.next();
  const ready: unknown = first.done === true ? undefined : JSON.parse(first.value);

  if (!Ready.Check(ready)) {
    child.kill();
    await child.exited;
    throw new Error(`Nyte Connect did not start:\n${stderr}`);
  }

  void (async () => {
    for await (const line of incoming) {
      const answer: unknown = JSON.parse(line);

      if (Answer.Check(answer)) waiting.get(answer.id)?.(answer);
    }
  })();

  let next = 0;

  const ask = async (request: Record<string, string>): Promise<unknown> => {
    const id = ++next;
    const answered = new Promise<unknown>((resolve) => waiting.set(id, resolve));
    await child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
    await child.stdin.flush();
    const answer = await answered;
    waiting.delete(id);
    assert.ok(Answer.Check(answer) && answer.error === undefined, JSON.stringify(answer));

    return answer.value;
  };

  const ca = await readFile(ready.ca, "utf8");

  /** The browser's fetch: real TLS to the front, trusting this run's CA and nothing else added. */
  const browserFetch = (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
    fetch(args[0], { ...args[1], tls: { ca } });

  /** A Clerk session JWT for the owner, as the signed-in browser holds it. */
  const sessionToken = async (sessionId: string): Promise<string> => {
    const token = await ask({ op: "token", sessionId });
    assert.ok(Token.Check(token));

    return token;
  };

  return {
    origin: ready.origin,
    /** The CA file a process trusts through NODE_EXTRA_CA_CERTS. */
    caPath: ready.ca,
    owner: ready.owner,
    browserFetch,

    async query(sql: string) {
      const rows = await ask({ op: "query", sql });
      assert.ok(Rows.Check(rows));

      return rows;
    },

    /** The owner at the link page: looks the code up, compares the fingerprint the CLI printed, approves. */
    async approve(userCode: string, fingerprint: string): Promise<LinkTransactionLookup> {
      const headers = {
        authorization: `Bearer ${await sessionToken("sess_qa_link")}`,
        "content-type": "application/json",
      };
      const looked = await browserFetch(`${ready.origin}/v1/link-transactions/lookup`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userCode }),
      });
      const lookup: unknown = await looked.json();
      assert.ok(Value.Check(LinkTransactionLookup, lookup), JSON.stringify(lookup));
      assert.equal(lookup.fingerprint, fingerprint);
      const approved = await browserFetch(
        `${ready.origin}/v1/link-transactions/${lookup.transactionId}/approve`,
        { method: "POST", headers, body: JSON.stringify({ fingerprint }) },
      );
      assert.equal(approved.status, 200, await approved.text());

      return lookup;
    },

    /** The web app enrolling this browser as a controller, then its client at the relay address. */
    async enroll(environmentId: string): Promise<NyteClient> {
      const broker = createBrokerClient({
        origin: ready.origin,
        sessionToken: () => sessionToken("sess_qa_browser"),
        fetch: browserFetch,
      });
      const token = base64Url(randomBytes(DEVICE_TOKEN_BYTES));
      const digest = base64ToBase64Url(createHash("sha256").update(token, "utf8").digest("base64"));
      await broker.enroll({
        environmentId,
        request: {
          clientId: "qa-browser-000001",
          clientName: "Web browser",
          digest,
          role: "controller",
        },
      });

      return createNyteClient({
        baseUrl: relayAddress(ready.origin, environmentId),
        token,
        fetch: browserFetch,
      });
    },

    async close() {
      await child.stdin.end();
      await child.exited;
    },
  };
}
