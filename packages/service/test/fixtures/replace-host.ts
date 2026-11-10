import { statSync } from "node:fs";
import { createServer } from "node:http";
import { parentPort } from "node:worker_threads";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const messages = Compile(
  Type.Union([
    Type.Object({ kind: Type.Literal("local"), port: Type.Integer(), buildFile: Type.String() }),
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

  const build = received.buildFile;
  const started = statSync(build).ino;

  server.listen(received.port, "127.0.0.1", () => {
    const address = server.address();

    if (address === null || typeof address === "string") throw new Error("No TCP address.");
    parent.postMessage({ kind: "listening", address: `http://127.0.0.1:${String(address.port)}` });

    const follow = setInterval(() => {
      if (statSync(build).ino === started) return;
      clearInterval(follow);
      close("replaced");
    }, 25);
  });
});
