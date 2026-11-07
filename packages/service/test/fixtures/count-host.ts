import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { parentPort } from "node:worker_threads";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const messages = Compile(
  Type.Union([
    Type.Object({ kind: Type.Literal("local"), port: Type.Integer() }),
    Type.Object({ kind: Type.Literal("stop") }),
  ]),
);

const parent = parentPort;

if (parent === null) throw new Error("count-host.ts runs as a host thread.");

const home = process.env["NYTE_HOME"];

if (home === undefined) throw new Error("count-host.ts needs NYTE_HOME.");

const server = createServer((_request, response) => response.end("{}"));

parent.on("message", (received: unknown) => {
  if (!messages.Check(received)) throw new Error("count-host.ts got an unknown message.");

  if (received.kind === "stop") {
    server.closeAllConnections();
    server.close(() => {
      parent.postMessage({ kind: "closed" });
      parent.close();
    });

    return;
  }

  appendFileSync(join(home, "starts"), "start\n");

  server.listen(received.port, "127.0.0.1", () => {
    const address = server.address();

    if (address === null || typeof address === "string") throw new Error("No TCP address.");
    parent.postMessage({ kind: "listening", address: `http://127.0.0.1:${String(address.port)}` });
  });
});
