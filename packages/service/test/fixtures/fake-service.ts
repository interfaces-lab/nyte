import { spawn } from "node:child_process";
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

const attached: number[] = [];

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

  const url = new URL(request.url ?? "/", "http://fake");

  if (url.pathname === SERVICE_ROUTES.attach) {
    const pid = Number(url.searchParams.get("pid"));
    attached.push(pid);
    request.on("close", () => attached.splice(attached.lastIndexOf(pid), 1));
    response.flushHeaders();

    return;
  }

  if (url.pathname === SERVICE_ROUTES.retire) {
    const caller = Number(url.searchParams.get("pid"));
    const clients = attached.filter((pid) => pid !== caller).length;

    if (clients > 0) {
      response.statusCode = 409;
      response.end(JSON.stringify({ clients, working: false }));

      return;
    }

    response.statusCode = 202;
    response.end(() => void stop());

    return;
  }

  response.end();
});

await once(server.listen(0, "127.0.0.1"), "listening");

const { port } = Value.Parse(Type.Object({ port: Type.Number() }), server.address());

const registration = {
  url: "",
  token: "t".repeat(32),
  pid: process.pid,
  version: build,
  hostId,
};

const stop = async (): Promise<never> => {
  await removeRegistration(home, registration);
  await lock.release();
  server.close();
  process.exit(0);
};

process.on("SIGTERM", () => {
  if (mode !== "stubborn") void stop();
});

if (mode === "stubborn")
  spawn(process.execPath, ["-e", "setTimeout(() => undefined, 30_000)"], { stdio: "ignore" });

setTimeout(() => void stop(), 30_000);

await sleep(Number(delay));

await writeRegistration(home, { ...registration, url: `http://127.0.0.1:${String(port)}` });
