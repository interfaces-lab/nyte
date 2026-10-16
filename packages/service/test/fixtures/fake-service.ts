/**
 * Stands in for `nyte service run`: takes the service lock, answers `/.nyte/describe` with its
 * host id, and renames its registration into place `delay` ms after it listens, the way
 * `startService` does. Run from the service home as `node fake-service.ts <version> <delay>`.
 */
import { once } from "node:events";
import { createServer } from "node:http";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { HOST_HEADER } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { acquireLock, removeRegistration, writeRegistration } from "../../src/registration.ts";

const [version = "v1", delay = "0"] = process.argv.slice(2);

const home = process.cwd();

const lock = await acquireLock(home, process.pid);

if (lock.kind === "held") {
  console.error(`error: The Nyte service is already running (pid ${String(lock.pid)}).`);
  process.exit(1);
}

const hostId = `host-${String(process.pid)}`;

const server = createServer((_request, response) => {
  response.setHeader(HOST_HEADER, hostId);
  response.end();
});

await once(server.listen(0, "127.0.0.1"), "listening");

const { port } = Value.Parse(Type.Object({ port: Type.Number() }), server.address());

const stop = async (): Promise<never> => {
  await removeRegistration(home, process.pid);
  await lock.release();
  server.close();
  process.exit(0);
};

process.once("SIGTERM", () => void stop());

setTimeout(() => void stop(), 30_000);

await sleep(Number(delay));

await writeRegistration(home, {
  url: `http://127.0.0.1:${String(port)}`,
  token: "t".repeat(32),
  pid: process.pid,
  version,
  hostId,
});
