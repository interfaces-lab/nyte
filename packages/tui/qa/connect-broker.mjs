/**
 * Nyte Connect for the headless account beat: the real Worker, relay Durable
 * Object and D1 in local workerd with only Clerk faked, behind an HTTPS front
 * on 127.0.0.1 whose certificate a CA made for this run signs. The binary
 * trusts that CA through NODE_EXTRA_CA_CERTS; no certificate check is off.
 *
 * Node runs this file, because wrangler's workerd harness never answers under
 * Bun; it is JavaScript so the TUI's Bun-typed check does not take in the
 * Node-typed harness it imports. It prints one JSON line `{ origin, ca }` once ready, then answers each
 * JSON line on stdin with one on stdout:
 * `{ id, op: "token", userId, sessionId }` mints a Clerk session JWT the
 * Worker accepts; `{ id, op: "query", sql }` reads D1. EOF on stdin stops it.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { createServer } from "node:tls";
import { promisify } from "node:util";
import { startWorkerdBroker } from "../../connect-worker/test/workerd.ts";

const run = promisify(execFile);

const OWNER = { userId: "user_qa_owner", email: "owner@qa.example" };

/** A one-day CA and a leaf for IP 127.0.0.1 it signs, made with the system openssl. */
async function certificates(directory) {
  const file = (name) => join(directory, name);
  await writeFile(
    file("ca.cnf"),
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = ca",
      "prompt = no",
      "[dn]",
      "CN = Nyte QA Connect CA",
      "[ca]",
      "basicConstraints = critical, CA:TRUE",
      "keyUsage = critical, keyCertSign, cRLSign",
      "subjectKeyIdentifier = hash",
    ].join("\n"),
  );
  await writeFile(
    file("leaf.cnf"),
    [
      "basicConstraints = critical, CA:FALSE",
      "keyUsage = critical, digitalSignature, keyEncipherment",
      "extendedKeyUsage = serverAuth",
      "subjectAltName = IP:127.0.0.1",
      "authorityKeyIdentifier = keyid",
    ].join("\n"),
  );
  const openssl = (...args) => run("openssl", args, { cwd: directory });
  await openssl(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-config",
    "ca.cnf",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
  );
  await openssl(
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  );
  await openssl(
    "x509",
    "-req",
    "-days",
    "1",
    "-in",
    "leaf.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-extfile",
    "leaf.cnf",
    "-out",
    "leaf.pem",
  );

  return {
    ca: file("ca.pem"),
    key: await readFile(file("leaf.key")),
    cert: await readFile(file("leaf.pem")),
  };
}

const directory = await mkdtemp(join(tmpdir(), "nyte-qa-connect-"));
const { ca, key, cert } = await certificates(directory);
const sockets = new Set();
let upstream;

// TLS ends here; the bytes, HTTP and WebSocket upgrades alike, go on to workerd unchanged.
const front = createServer({ key, cert }, (client) => {
  sockets.add(client);
  client.on("close", () => sockets.delete(client));

  if (upstream === undefined) {
    client.destroy();

    return;
  }

  const worker = connect(upstream, "127.0.0.1");
  sockets.add(worker);
  worker.on("close", () => sockets.delete(worker));
  client.pipe(worker).pipe(client);
  client.on("error", () => worker.destroy());
  worker.on("error", () => client.destroy());
});

// A fixed port lets a binary built with this origin baked in reach it; any free port otherwise.
await new Promise((resolve) =>
  front.listen(Number(process.env.NYTE_QA_CONNECT_PORT ?? 0), "127.0.0.1", resolve),
);
const address = front.address();

if (address === null || typeof address === "string") throw new Error("The HTTPS front has no port");
const origin = `https://127.0.0.1:${String(address.port)}`;
const broker = await startWorkerdBroker({ origin });
upstream = Number(broker.local.port);
broker.clerk.users.set(OWNER.userId, {
  banned: false,
  locked: false,
  updated_at: 1,
  email: OWNER.email,
});

const stop = async () => {
  for (const socket of sockets) socket.destroy();
  front.close();
  await broker.close();
  await rm(directory, { recursive: true, force: true });
};

process.stdout.write(`${JSON.stringify({ origin, ca, owner: OWNER })}\n`);

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);

  if (typeof request !== "object" || request === null || !("id" in request) || !("op" in request))
    continue;

  try {
    const value =
      request.op === "token" && "sessionId" in request && typeof request.sessionId === "string"
        ? await broker.sessionToken({ userId: OWNER.userId, sessionId: request.sessionId })
        : request.op === "query" && "sql" in request && typeof request.sql === "string"
          ? await broker.query(request.sql)
          : undefined;
    process.stdout.write(`${JSON.stringify({ id: request.id, value })}\n`);
  } catch (cause) {
    process.stdout.write(
      `${JSON.stringify({ id: request.id, error: cause instanceof Error ? cause.message : String(cause) })}\n`,
    );
  }
}

await stop();
