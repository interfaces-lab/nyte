/**
 * Stands in for `nyte service run`: takes the service lock, answers `/.nyte/describe` with its
 * host id, and renames its registration, under build `build`, into place `delay` ms after it
 * listens, the way `startService` does. A `stale` service answers every other request the
 * way a host built before an operation answers it; a `stubborn` one also ignores SIGTERM. A
 * `fresh` service holds each attach request open until it exits, as `startService` does.
 * Run from the service home as `node fake-service.ts <build> <delay> [fresh|stale|stubborn]`.
 */
import { once } from "node:events";
import { createServer } from "node:http";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { HOST_HEADER } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { acquireLock, removeRegistration, writeRegistration } from "../../src/registration.ts";
import { SERVICE_ROUTES } from "../../src/routes.ts";

const [build = "v1", delay = "0", mode = "fresh"] = process.argv.slice(2);

const home = process.cwd();

const lock = await acquireLock(home, process.pid);

if (lock.kind === "held") {
  console.error(`error: The Nyte service is already running (pid ${String(lock.pid)}).`);
  process.exit(1);
}

const hostId = `host-${String(process.pid)}`;

const server = createServer((request, response) => {
  response.setHeader(HOST_HEADER, hostId);

  if (mode !== "fresh" && request.url !== "/.nyte/describe") {
    response.statusCode = 404;
    response.end(
      JSON.stringify({
        message: `No operation answers ${String(request.method)} ${String(request.url)}.`,
      }),
    );

    return;
  }

  if (request.url?.startsWith(SERVICE_ROUTES.attach) === true) {
    response.flushHeaders();

    return;
  }

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

process.on("SIGTERM", () => {
  if (mode !== "stubborn") void stop();
});

setTimeout(() => void stop(), 30_000);

await sleep(Number(delay));

await writeRegistration(home, {
  url: `http://127.0.0.1:${String(port)}`,
  token: "t".repeat(32),
  pid: process.pid,
  version: build,
  hostId,
});
