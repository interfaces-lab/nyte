import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { hostRetirePath } from "../../src/host-endpoint.ts";

const messages = Compile(
  Type.Union([
    Type.Object({
      kind: Type.Literal("local"),
      port: Type.Integer(),
      supervisor: Type.Enum(["launchd", "nyte"]),
    }),
    Type.Object({ kind: Type.Literal("stop") }),
  ]),
);

const parent = parentPort;

if (parent === null) throw new Error("replace-host.ts runs as a host thread.");

const server = createServer((_request, response) => response.end("{}"));

const close = (report: "replaced" | "closed"): void => {
  server.closeAllConnections();
  server.close(() => parent.postMessage({ kind: report }));
};

parent.on("message", (received: unknown) => {
  if (!messages.Check(received)) throw new Error("replace-host.ts got an unknown message.");

  if (received.kind === "stop") {
    close("closed");

    return;
  }

  const supervisor = received.supervisor;
  const folder = hostRetirePath();

  server.listen(received.port, "127.0.0.1", () => {
    const address = server.address();

    if (address === null || typeof address === "string") throw new Error("No TCP address.");
    parent.postMessage({ kind: "listening", address: `http://127.0.0.1:${String(address.port)}` });

    const follow = setInterval(() => {
      const names = existsSync(folder) ? readdirSync(folder) : [];

      if (!names.some((name) => readFileSync(join(folder, name), "utf8") === supervisor)) return;
      clearInterval(follow);
      close("replaced");
    }, 25);
  });
});
